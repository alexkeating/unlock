const BigNumber = require('bignumber.js')
const { tokens } = require('hardlydifficult-ethereum-contracts')

const { ADDRESS_ZERO, MAX_UINT } = require('../helpers/constants')
const unlockContract = artifacts.require('Unlock.sol')
const TestNoop = artifacts.require('TestNoop.sol')
const { reverts } = require('../helpers/errors')
const getContractInstance = require('../helpers/truffle-artifacts')
const deployLocks = require('../helpers/deployLocks')

contract('Lock / erc20', (accounts) => {
  let unlock
  let token
  let lock

  beforeEach(async () => {
    token = await tokens.dai.deploy(web3, accounts[0])
    // Mint some tokens so that the totalSupply is greater than 0
    await token.mint(accounts[0], 1, {
      from: accounts[0],
    })
    unlock = await getContractInstance(unlockContract)
    const locks = await deployLocks(unlock, accounts[0], token.address)
    lock = locks.FIRST
    await lock.setMaxKeysPerAddress(10)
  })

  describe('creating ERC20 priced locks', () => {
    let keyPrice
    let refundAmount
    const keyOwner = accounts[1]
    const keyOwner2 = accounts[2]
    const keyOwner3 = accounts[3]
    const defaultBalance = new BigNumber(100000000000000000)

    beforeEach(async () => {
      // Pre-req
      assert.equal(await token.balanceOf(keyOwner), 0)
      assert.equal(await token.balanceOf(lock.address), 0)

      // Mint some tokens for testing
      await token.mint(keyOwner, defaultBalance, {
        from: accounts[0],
      })
      await token.mint(keyOwner2, defaultBalance, {
        from: accounts[0],
      })
      await token.mint(keyOwner3, defaultBalance, {
        from: accounts[0],
      })

      // Approve the lock to make transfers
      await token.approve(lock.address, MAX_UINT, { from: keyOwner })
      await token.approve(lock.address, MAX_UINT, { from: keyOwner2 })
      await token.approve(lock.address, MAX_UINT, { from: keyOwner3 })

      keyPrice = new BigNumber(await lock.keyPrice())
      refundAmount = keyPrice.toFixed()
    })

    describe('users can purchase keys', () => {
      let tokenId
      beforeEach(async () => {
        const tx = await lock.purchase(
          [keyPrice.toFixed()],
          [keyOwner],
          [ADDRESS_ZERO],
          [ADDRESS_ZERO],
          [[]],
          {
            from: keyOwner,
          }
        )

        const tokenIds = tx.logs
          .filter((v) => v.event === 'Transfer')
          .map(({ args }) => args.tokenId)

        tokenId = tokenIds[0]
      })

      it('charges correct amount on purchaseKey', async () => {
        const balance = new BigNumber(await token.balanceOf(keyOwner))
        assert.equal(
          balance.toFixed(),
          defaultBalance.minus(keyPrice).toFixed()
        )
      })

      it('transferred the tokens to the contract', async () => {
        const balance = new BigNumber(await token.balanceOf(lock.address))
        assert.equal(balance.toFixed(), keyPrice.toFixed())
      })

      it('when a lock owner refunds a key, tokens are fully refunded', async () => {
        const tx = await lock.purchase(
          [keyPrice.toFixed()],
          [keyOwner3],
          [ADDRESS_ZERO],
          [ADDRESS_ZERO],
          [[]],
          {
            from: keyOwner3,
          }
        )

        const { args } = tx.logs.find((v) => v.event === 'Transfer')
        const tokenId = args.tokenId

        const balanceOwnerBefore = new BigNumber(
          await token.balanceOf(keyOwner3)
        )
        const balanceLockBefore = new BigNumber(
          await token.balanceOf(lock.address)
        )

        await lock.expireAndRefundFor(tokenId, refundAmount, {
          from: accounts[0],
        })
        const balanceOwnerAfter = new BigNumber(
          await token.balanceOf(keyOwner3)
        )
        const balanceLockAfter = new BigNumber(
          await token.balanceOf(lock.address)
        )

        assert.equal(
          balanceLockBefore.minus(keyPrice).toFixed(),
          balanceLockAfter.toFixed()
        )

        assert.equal(
          balanceOwnerBefore.plus(keyPrice).toFixed(),
          balanceOwnerAfter.toFixed()
        )
      })

      it('when a key owner cancels a key, they are refunded in tokens', async () => {
        const balance = new BigNumber(await token.balanceOf(keyOwner))
        await lock.cancelAndRefund(tokenId, { from: keyOwner })
        assert(balance.lt(await token.balanceOf(keyOwner)))
      })

      it('the owner can withdraw tokens', async () => {
        const lockBalance = new BigNumber(await token.balanceOf(lock.address))
        const ownerBalance = new BigNumber(await token.balanceOf(accounts[0]))

        await lock.withdraw(await lock.tokenAddress(), 0, {
          from: accounts[0],
        })

        assert.equal(await token.balanceOf(lock.address), 0)
        assert.equal(
          await token.balanceOf(accounts[0]),
          ownerBalance.plus(lockBalance).toFixed()
        )
      })

      it('purchaseForFrom works as well', async () => {
        // The referrer needs a valid key for this test
        await lock.purchase(
          [keyPrice.toFixed()],
          [keyOwner],
          [ADDRESS_ZERO],
          [ADDRESS_ZERO],
          [[]],
          {
            from: keyOwner,
          }
        )
        const balanceBefore = new BigNumber(await token.balanceOf(keyOwner2))

        await lock.purchase(
          [keyPrice.toFixed()],
          [keyOwner2],
          [keyOwner],
          [ADDRESS_ZERO],
          [[]],
          {
            from: keyOwner2,
          }
        )

        const balance = new BigNumber(await token.balanceOf(keyOwner2))
        assert.equal(balance.toFixed(), balanceBefore.minus(keyPrice).toFixed())
      })

      it('can transfer the key to another user', async () => {
        await lock.transferFrom(keyOwner, accounts[4], tokenId, {
          from: keyOwner,
        })
      })
    })

    it('purchaseKey fails when the user does not have enough funds', async () => {
      const account = accounts[4]
      await token.approve(lock.address, MAX_UINT, { from: account })
      await token.mint(account, keyPrice.minus(1), {
        from: accounts[0],
      })
      await reverts(
        lock.purchase(
          [keyPrice.toFixed()],
          [account],
          [ADDRESS_ZERO],
          [ADDRESS_ZERO],
          [[]],
          {
            from: account,
          }
        )
      )
    })

    it('purchaseKey fails when the user did not give the contract an allowance', async () => {
      const account = accounts[4]
      await token.mint(account, keyPrice, {
        from: accounts[0],
      })
      await reverts(
        lock.purchase(
          [keyPrice.toFixed()],
          [account],
          [ADDRESS_ZERO],
          [ADDRESS_ZERO],
          [[]],
          {
            from: account,
          }
        )
      )
    })
  })

  describe('should fail to create a lock when', () => {
    it('when creating a lock for a contract which is not an ERC20', async () => {
      await reverts(
        deployLocks(unlock, accounts[0], (await TestNoop.new()).address)
      )
    })

    describe('when creating a lock with an invalid ERC20', () => {
      // TODO: testing this requires using web3 instead of truffle methods
      // (truffle fails with `no code at address`)
    })
  })

  describe('when the ERC20 is paused', () => {
    // TODO: testing this requires creating a new test-artifact with pause capabilities
  })
})
