// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// import '@openzeppelin/contracts-upgradeable/token/ERC721/extensions/IERC721EnumerableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol';
import './MixinDisable.sol';
import './MixinRoles.sol';
import './MixinErrors.sol';
import '../interfaces/IUnlock.sol';
import './MixinFunds.sol';
import '../interfaces/hooks/ILockKeyCancelHook.sol';
import '../interfaces/hooks/ILockKeyPurchaseHook.sol';
import '../interfaces/hooks/ILockValidKeyHook.sol';
import '../interfaces/hooks/ILockTokenURIHook.sol';
import '../interfaces/hooks/ILockKeyTransferHook.sol';

/**
 * @title Mixin for core lock data and functions.
 * @author HardlyDifficult
 * @dev `Mixins` are a design pattern seen in the 0x contracts.  It simply
 * separates logically groupings of code to ease readability.
 */
contract MixinLockCore is
  MixinRoles,
  MixinFunds,
  MixinDisable
{
  using AddressUpgradeable for address;

  event Withdrawal(
    address indexed sender,
    address indexed tokenAddress,
    address indexed beneficiary,
    uint amount
  );

  event PricingChanged(
    uint oldKeyPrice,
    uint keyPrice,
    address oldTokenAddress,
    address tokenAddress
  );

   /**
    * @dev Emitted when `tokenId` token is transferred from `from` to `to`.
    */
  event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

  /**
    * @dev Emitted when `owner` enables `approved` to manage the `tokenId` token.
    */
  event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);

  /**
    * @dev Emitted when `owner` enables or disables (`approved`) `operator` to manage all of its assets.
    */
  event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

  // Unlock Protocol address
  // TODO: should we make that private/internal?
  IUnlock public unlockProtocol;

  // Duration in seconds for which the keys are valid, after creation
  // should we take a smaller type use less gas?
  uint public expirationDuration;

  // price in wei of the next key
  // TODO: allow support for a keyPriceCalculator which could set prices dynamically
  uint public keyPrice;

  // Max number of keys sold if the keyReleaseMechanism is public
  uint public maxNumberOfKeys;

  // A count of how many new key purchases there have been
  uint internal _totalSupply;

  // The account which will receive funds on withdrawal
  address payable public beneficiary;

  // The denominator component for values specified in basis points.
  uint internal constant BASIS_POINTS_DEN = 10000;

  // lock hooks
  ILockKeyPurchaseHook public onKeyPurchaseHook;
  ILockKeyCancelHook public onKeyCancelHook;
  ILockValidKeyHook public onValidKeyHook;
  ILockTokenURIHook public onTokenURIHook;

  // use to check data version (added to v10)
  uint public schemaVersion;

  // keep track of how many key a single address can use (added to v10)
  uint internal _maxKeysPerAddress;

  // one more hook (added to v11)
  ILockKeyTransferHook public onKeyTransferHook;

  // modifier to check if data has been upgraded
  function _lockIsUpToDate() internal view {
    if(schemaVersion != publicLockVersion()) {
      revert MIGRATION_REQUIRED();
    }
  }

  // modifier
  function _onlyLockManagerOrBeneficiary() 
  internal 
  view
  {
    if(!isLockManager(msg.sender) && msg.sender != beneficiary) {
      revert ONLY_LOCK_MANAGER_OR_BENEFICIARY();
    }
  }
  
  function _initializeMixinLockCore(
    address payable _beneficiary,
    uint _expirationDuration,
    uint _keyPrice,
    uint _maxNumberOfKeys
  ) internal
  {
    unlockProtocol = IUnlock(msg.sender); // Make sure we link back to Unlock's smart contract.
    beneficiary = _beneficiary;
    expirationDuration = _expirationDuration;
    keyPrice = _keyPrice;
    maxNumberOfKeys = _maxNumberOfKeys;

    // update only when initialized
    schemaVersion = publicLockVersion();

    // only a single key per address is allowed by default
    _maxKeysPerAddress = 1;
  }

  // The version number of the current implementation on this network
  function publicLockVersion(
  ) public pure
    returns (uint16)
  {
    return 11;
  }

  /**
   * @dev Called by owner to withdraw all funds from the lock and send them to the `beneficiary`.
   * @param _tokenAddress specifies the token address to withdraw or 0 for ETH. This is usually
   * the same as `tokenAddress` in MixinFunds.
   * @param _amount specifies the max amount to withdraw, which may be reduced when
   * considering the available balance. Set to 0 or MAX_UINT to withdraw everything.
   */
  function withdraw(
    address _tokenAddress,
    uint _amount
  ) external
  {
    _onlyLockManagerOrBeneficiary();

    // get balance
    uint balance;
    if(_tokenAddress == address(0)) {
      balance = address(this).balance;
    } else {
      balance = IERC20Upgradeable(_tokenAddress).balanceOf(address(this));
    }

    uint amount;
    if(_amount == 0 || _amount > balance)
    {
      if(balance <= 0) {
        revert NOT_ENOUGH_FUNDS();
      }
      amount = balance;
    }
    else
    {
      amount = _amount;
    }

    emit Withdrawal(msg.sender, _tokenAddress, beneficiary, amount);
    // Security: re-entrancy not a risk as this is the last line of an external function
    _transfer(_tokenAddress, beneficiary, amount);
  }

  /**
   * A function which lets the owner of the lock change the pricing for future purchases.
   * This consists of 2 parts: The token address and the price in the given token.
   * In order to set the token to ETH, use 0 for the token Address.
   */
  function updateKeyPricing(
    uint _keyPrice,
    address _tokenAddress
  )
    external
  {
    _onlyLockManager();
    _isValidToken(_tokenAddress);
    uint oldKeyPrice = keyPrice;
    address oldTokenAddress = tokenAddress;
    keyPrice = _keyPrice;
    tokenAddress = _tokenAddress;
    emit PricingChanged(oldKeyPrice, keyPrice, oldTokenAddress, tokenAddress);
  }

  /**
   * A function which lets the owner of the lock update the beneficiary account,
   * which receives funds on withdrawal.
   */
  function updateBeneficiary(
    address payable _beneficiary
  ) external {
    _onlyLockManagerOrBeneficiary();
    if(_beneficiary == address(0)) {
      revert INVALID_ADDRESS();
    }
    beneficiary = _beneficiary;
  }

  /**
   * @notice Allows a lock manager to add or remove an event hook
   */
  function setEventHooks(
    address _onKeyPurchaseHook,
    address _onKeyCancelHook,
    address _onValidKeyHook,
    address _onTokenURIHook,
    address _onKeyTransferHook
  ) external
  {
    _onlyLockManager();

    if(_onKeyPurchaseHook != address(0) && !_onKeyPurchaseHook.isContract()) { revert INVALID_HOOK(0); }
    if(_onKeyCancelHook != address(0) && !_onKeyCancelHook.isContract()) { revert INVALID_HOOK(1); }
    if(_onValidKeyHook != address(0) && !_onValidKeyHook.isContract()) { revert INVALID_HOOK(2); }
    if(_onTokenURIHook != address(0) && !_onTokenURIHook.isContract()) { revert INVALID_HOOK(3); }
    if(_onKeyTransferHook != address(0) && !_onKeyTransferHook.isContract()) { revert INVALID_HOOK(4); }
    
    onKeyPurchaseHook = ILockKeyPurchaseHook(_onKeyPurchaseHook);
    onKeyCancelHook = ILockKeyCancelHook(_onKeyCancelHook);
    onTokenURIHook = ILockTokenURIHook(_onTokenURIHook);
    onValidKeyHook = ILockValidKeyHook(_onValidKeyHook);
    onKeyTransferHook = ILockKeyTransferHook(_onKeyTransferHook);
  }

  function totalSupply()
    public
    view returns(uint256)
  {
    return _totalSupply;
  }

  /**
   * @notice An ERC-20 style approval, allowing the spender to transfer funds directly from this lock.
   */
  function approveBeneficiary(
    address _spender,
    uint _amount
  ) public
    returns (bool)
  {
    _onlyLockManagerOrBeneficiary();
    return IERC20Upgradeable(tokenAddress).approve(_spender, _amount);
  }


  // decreased from 1000 to 998 when adding `schemaVersion` and `maxKeysPerAddress` in v10 
  // decreased from 998 to 997 when adding `onKeyTransferHook` in v11
  uint256[997] private __safe_upgrade_gap;
}
