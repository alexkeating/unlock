const BigNumber = require('bignumber.js')
const { assert } = require('chai')
const deployLocks = require('../helpers/deployLocks')
const { ADDRESS_ZERO } = require('../helpers/constants')

const unlockContract = artifacts.require('Unlock.sol')
const getContractInstance = require('../helpers/truffle-artifacts')

let lock
let locks
let unlock
let tokenIds

contract('Lock / owners', (accounts) => {
  const keyOwners = accounts.slice(1, 6)
  before(async () => {
    unlock = await getContractInstance(unlockContract)
    locks = await deployLocks(unlock, accounts[0])
    lock = locks.FIRST
    await lock.setMaxKeysPerAddress(10)
    await lock.updateTransferFee(0) // disable the transfer fee for this test
  })

  before(async () => {
    // Purchase keys!
    const tx = await lock.purchase(
      [],
      keyOwners,
      keyOwners.map(() => ADDRESS_ZERO),
      keyOwners.map(() => ADDRESS_ZERO),
      keyOwners.map(() => []),
      {
        value: (lock.params.keyPrice * keyOwners.length).toFixed(),
        from: accounts[0],
      }
    )
    tokenIds = tx.logs
      .filter((v) => v.event === 'Transfer')
      .map(({ args }) => args.tokenId)
  })

  it('should have the right number of keys', async () => {
    const totalSupply = new BigNumber(await lock.totalSupply())
    assert.equal(totalSupply.toFixed(), keyOwners.length)
  })

  it('should have the right number of owners', async () => {
    const numberOfOwners = new BigNumber(await lock.numberOfOwners())
    assert.equal(numberOfOwners.toFixed(), keyOwners.length)
  })

  describe('after a transfer to a new address', () => {
    let numberOfOwners

    before(async () => {
      numberOfOwners = new BigNumber(await lock.numberOfOwners())
      await lock.transferFrom(keyOwners[0], accounts[8], tokenIds[0], {
        from: keyOwners[0],
      })
    })

    it('should have the right number of keys', async () => {
      const totalSupply = new BigNumber(await lock.totalSupply())
      assert.equal(totalSupply.toFixed(), tokenIds.length)
    })

    it('should have the right number of owners', async () => {
      assert.equal(await lock.balanceOf(accounts[8]), 1)
      assert.equal(await lock.balanceOf(keyOwners[0]), 0)
      const _numberOfOwners = new BigNumber(await lock.numberOfOwners())
      assert.equal(_numberOfOwners.toFixed(), numberOfOwners.toFixed())
    })
  })

  describe('after a transfer to an existing owner', () => {
    let numberOfOwners

    before(async () => {
      numberOfOwners = new BigNumber(await lock.numberOfOwners())

      // both have tokens
      assert.equal(await lock.balanceOf(keyOwners[1]), 1)
      assert.equal(await lock.balanceOf(keyOwners[2]), 1)
      await lock.transferFrom(keyOwners[1], keyOwners[2], tokenIds[1], {
        from: keyOwners[1],
      })
    })

    it('should have the right number of keys', async () => {
      const totalSupply = new BigNumber(await lock.totalSupply())
      assert.equal(totalSupply.toFixed(), tokenIds.length)
    })

    it('should have the right number of owners', async () => {
      const _numberOfOwners = new BigNumber(await lock.numberOfOwners())
      assert.equal(_numberOfOwners.toFixed(), numberOfOwners.toFixed() - 1)
    })
  })

  // test case proofing https://github.com/code-423n4/2021-11-unlock-findings/issues/120
  describe('after a transfer to a existing owner, buying a key again for someone who already owned one', () => {
    it('should preserve the right number of owners', async () => {
      // initial state
      const numberOfOwners = new BigNumber(await lock.numberOfOwners())
      const totalSupplyBefore = new BigNumber(await lock.totalSupply())

      // transfer the key to an existing owner
      assert.equal(await lock.balanceOf(keyOwners[4]), 1)
      await lock.transferFrom(keyOwners[3], keyOwners[4], tokenIds[3], {
        from: keyOwners[3],
      })
      assert.equal(await lock.ownerOf(tokenIds[3]), keyOwners[4])
      assert.equal(await lock.balanceOf(keyOwners[4]), 2)
      assert.equal(await lock.balanceOf(keyOwners[3]), 0)

      // supply unchanged
      const totalSupplyAfter = new BigNumber(await lock.totalSupply())
      assert.equal(totalSupplyBefore.toFixed(), totalSupplyAfter.toFixed())

      // number of owners changed
      assert.equal(
        (numberOfOwners - 1).toFixed(),
        new BigNumber(await lock.numberOfOwners()).toFixed()
      )

      // someone buys a key again for the previous owner
      await lock.purchase(
        [],
        [keyOwners[3]],
        [ADDRESS_ZERO],
        [ADDRESS_ZERO],
        [[]],
        {
          value: lock.params.keyPrice.toFixed(),
          from: keyOwners[3],
        }
      )

      // number of owners should be left unchanged
      const _numberOfOwners = new BigNumber(await lock.numberOfOwners())
      assert.equal(_numberOfOwners.toFixed(), numberOfOwners.toFixed())
    })
  })
})
