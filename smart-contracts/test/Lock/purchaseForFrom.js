const deployLocks = require('../helpers/deployLocks')
const { ADDRESS_ZERO } = require('../helpers/constants')

const unlockContract = artifacts.require('Unlock.sol')
const getContractInstance = require('../helpers/truffle-artifacts')

let unlock
let locks

contract('Lock / purchaseForFrom', (accounts) => {
  before(async () => {
    unlock = await getContractInstance(unlockContract)
    locks = await deployLocks(unlock, accounts[0])
    await locks.FIRST.setMaxKeysPerAddress(10)
  })

  describe('if the referrer does not have a key', () => {
    it('should succeed', async () => {
      const lock = locks.FIRST
      await lock.purchase(
        [],
        [accounts[0]],
        [accounts[1]],
        [ADDRESS_ZERO],
        [[]],
        {
          value: web3.utils.toWei('0.01', 'ether'),
        }
      )
    })
  })

  describe('if the referrer has a key', () => {
    it('should succeed', async () => {
      const lock = locks.FIRST
      await lock.purchase(
        [],
        [accounts[0]],
        [ADDRESS_ZERO],
        [ADDRESS_ZERO],
        [[]],
        {
          value: web3.utils.toWei('0.01', 'ether'),
        }
      )
      await lock.purchase(
        [],
        [accounts[1]],
        [accounts[0]],
        [ADDRESS_ZERO],
        [[]],
        {
          value: web3.utils.toWei('0.01', 'ether'),
        }
      )
    })

    it('can purchaseForFrom a free key', async () => {
      await locks.FREE.purchase(
        [],
        [accounts[0]],
        [ADDRESS_ZERO],
        [ADDRESS_ZERO],
        [[]]
      )
      const tx = await locks.FREE.purchase(
        [],
        [accounts[2]],
        [accounts[0]],
        [ADDRESS_ZERO],
        [[]]
      )
      assert.equal(tx.logs[0].event, 'Transfer')
      assert.equal(tx.logs[0].args.from, 0)
      assert.equal(tx.logs[0].args.to, accounts[2])
    })
  })
})
