const { reverts } = require('../../helpers/errors')
const BigNumber = require('bignumber.js')
const deployLocks = require('../../helpers/deployLocks')
const getContractInstance = require('../../helpers/truffle-artifacts')
const { ADDRESS_ZERO } = require('../../helpers/constants')

const unlockContract = artifacts.require('Unlock.sol')

let unlock
let locks
let lock
let lockCreator

contract('Permissions / KeyManager', (accounts) => {
  lockCreator = accounts[0]
  const lockManager = lockCreator
  const keyPrice = new BigNumber(web3.utils.toWei('0.01', 'ether'))
  let tokenId
  let keyManager
  let keyManagerBefore

  before(async () => {
    unlock = await getContractInstance(unlockContract)
    locks = await deployLocks(unlock, lockCreator)
    lock = locks.FIRST
    const tx = await lock.purchase(
      [],
      [accounts[1]],
      [ADDRESS_ZERO],
      [ADDRESS_ZERO],
      [[]],
      {
        value: keyPrice.toFixed(),
        from: accounts[1],
      }
    )
    const { args } = tx.logs.find((v) => v.event === 'Transfer')
    tokenId = args.tokenId

    await lock.approve(accounts[7], tokenId, {
      from: accounts[1],
    })
  })

  describe('setting the key manager', () => {
    it('should have a default KM of 0x00', async () => {
      keyManagerBefore = await lock.keyManagerOf(tokenId)
      assert.equal(keyManagerBefore, ADDRESS_ZERO)
    })

    // ensure that by default the owner is also the keyManager
    it('should allow the default keyManager to set a new KM', async () => {
      const defaultKeyManager = accounts[1]
      await lock.setKeyManagerOf(tokenId, accounts[9], {
        from: defaultKeyManager,
      })
      keyManager = await lock.keyManagerOf(tokenId)
      assert.equal(keyManager, accounts[9])
    })

    it('should allow the current keyManager to set a new KM', async () => {
      keyManagerBefore = await lock.keyManagerOf(tokenId)
      await lock.setKeyManagerOf(tokenId, accounts[3], {
        from: keyManagerBefore,
      })
      keyManager = await lock.keyManagerOf(tokenId)
      assert.equal(keyManager, accounts[3])
    })

    it('should allow a LockManager to set a new KM', async () => {
      keyManagerBefore = await lock.keyManagerOf(tokenId)
      await lock.setKeyManagerOf(tokenId, accounts[5], { from: lockManager })
      keyManager = await lock.keyManagerOf(tokenId)
      assert.notEqual(keyManagerBefore, keyManager)
      assert.equal(keyManager, accounts[5])
    })

    // confirm that approvals are cleared for expired keys
    it('should clear any erc721-approvals for expired keys', async () => {
      const approved = await lock.getApproved(tokenId)
      assert.equal(approved, 0)
    })

    it('should fail to allow anyone else to set a new KM', async () => {
      await reverts(
        lock.setKeyManagerOf(tokenId, accounts[2], { from: accounts[6] }),
        'UNAUTHORIZED_KEY_MANAGER_UPDATE'
      )
    })
    describe('setting the KM to 0x00', () => {
      before(async () => {
        keyManager = await lock.keyManagerOf(tokenId)
        await lock.setKeyManagerOf(tokenId, accounts[9], { from: keyManager })
        keyManager = await lock.keyManagerOf(tokenId)
        assert.equal(keyManager, accounts[9])
        await lock.setKeyManagerOf(tokenId, ADDRESS_ZERO)
      })

      it('should reset to the default KeyManager of 0x00', async () => {
        keyManager = await lock.keyManagerOf(tokenId)
        assert.equal(keyManager, ADDRESS_ZERO)
      })
    })
  })
})
