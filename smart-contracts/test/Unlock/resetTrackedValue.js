const BigNumber = require('bignumber.js')
const { reverts } = require('../helpers/errors')

const deployLocks = require('../helpers/deployLocks')

const unlockContract = artifacts.require('Unlock.sol')
const getContractInstance = require('../helpers/truffle-artifacts')

const keyPrice = web3.utils.toWei('0.01', 'ether')
const { ADDRESS_ZERO } = require('../helpers/constants')

let unlock
let lock

contract('Unlock / resetTrackedValue', (accounts) => {
  beforeEach(async () => {
    unlock = await getContractInstance(unlockContract)
    const locks = await deployLocks(unlock, accounts[0])
    lock = locks.FIRST
    await lock.purchase(
      [keyPrice],
      [accounts[1]],
      [ADDRESS_ZERO],
      [ADDRESS_ZERO],
      [[]],
      {
        from: accounts[1],
        value: keyPrice,
      }
    )
  })

  it('grossNetworkProduct has a non-zero value after a purchase', async () => {
    const grossNetworkProduct = await unlock.grossNetworkProduct()
    assert.equal(grossNetworkProduct, keyPrice)
  })

  it('should fail to resetTrackedValue if called from a non-owner account', async () => {
    await reverts(
      unlock.resetTrackedValue(0, 0, { from: accounts[1] }),
      'ONLY_OWNER'
    )
  })

  describe('resetTrackedValue to 0', async () => {
    beforeEach(async () => {
      await unlock.resetTrackedValue(0, 0, { from: accounts[0] })
    })

    it('grossNetworkProduct is now 0', async () => {
      const grossNetworkProduct = await unlock.grossNetworkProduct()
      assert.equal(grossNetworkProduct, 0)
    })

    describe('After purchase', () => {
      beforeEach(async () => {
        await lock.purchase(
          [keyPrice],
          [accounts[2]],
          [ADDRESS_ZERO],
          [ADDRESS_ZERO],
          [[]],
          {
            from: accounts[2],
            value: keyPrice,
          }
        )
      })

      it('grossNetworkProduct has a non-zero value after a purchase', async () => {
        const grossNetworkProduct = await unlock.grossNetworkProduct()
        assert.equal(grossNetworkProduct, keyPrice)
      })
    })
  })

  describe('resetTrackedValue to 42', async () => {
    beforeEach(async () => {
      await unlock.resetTrackedValue(42, 0, { from: accounts[0] })
    })

    it('grossNetworkProduct is now 42', async () => {
      const grossNetworkProduct = await unlock.grossNetworkProduct()
      assert.equal(grossNetworkProduct, 42)
    })

    describe('After purchase', () => {
      beforeEach(async () => {
        await lock.purchase(
          [keyPrice],
          [accounts[2]],
          [ADDRESS_ZERO],
          [ADDRESS_ZERO],
          [[]],
          {
            from: accounts[2],
            value: keyPrice,
          }
        )
      })

      it('grossNetworkProduct has a non-zero value after a purchase', async () => {
        const grossNetworkProduct = await unlock.grossNetworkProduct()
        assert.equal(
          grossNetworkProduct,
          new BigNumber(keyPrice).plus(42).toFixed()
        )
      })
    })
  })
})
