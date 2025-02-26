import type { Web3Service } from '@unlock-protocol/unlock-js'
import { Response, Request } from 'express'
import * as z from 'zod'
import { Op } from 'sequelize'
import Normalizer from '../../utils/normalizer'
import * as metadataOperations from '../../operations/metadataOperations'
import logger from '../../logger'
import { KeyMetadata } from '../../models/keyMetadata'
import { LockMetadata } from '../../models/lockMetadata'
import { UserTokenMetadata } from '../../models'

const UserMetadata = z
  .object({
    public: z.record(z.string(), z.any()).optional(),
    protected: z.record(z.string(), z.any()).optional(),
  })
  .strict()
  .partial()

const UserMetadataBody = z.object({
  lockAddress: z.string(),
  userAddress: z.string(),
  metadata: UserMetadata,
})

const BulkUserMetadataBody = z.object({
  users: z.array(UserMetadataBody),
})

interface IsKeyOrLockOwnerOptions {
  userAddress?: string
  lockAddress: string
  keyId: string
  network: number
}

export class MetadataController {
  public web3Service: Web3Service

  constructor({ web3Service }: { web3Service: Web3Service }) {
    this.web3Service = web3Service
  }

  async #isKeyOrLockOwner({
    userAddress,
    lockAddress,
    keyId,
    network,
  }: IsKeyOrLockOwnerOptions) {
    if (!userAddress) {
      return false
    }
    const loggedUserAddress = Normalizer.ethereumAddress(userAddress)
    const isLockOwner = await this.web3Service.isLockManager(
      lockAddress,
      loggedUserAddress,
      network
    )

    const keyOwner = await this.web3Service.ownerOf(lockAddress, keyId, network)

    const keyOwnerAddress = Normalizer.ethereumAddress(keyOwner)

    const isKeyOwner = keyOwnerAddress === loggedUserAddress

    return isLockOwner || isKeyOwner
  }

  async getLockMetadata(request: Request, response: Response) {
    try {
      const network = Number(request.params.network)
      const lockAddress = Normalizer.ethereumAddress(request.params.lockAddress)

      const lockData = await LockMetadata.findOne({
        where: {
          chain: network,
          address: lockAddress,
        },
      })

      if (!lockData) {
        return response.status(404).send({
          message: 'No lock metadata found.',
        })
      }
      return response.status(200).send(lockData.data)
    } catch (error) {
      logger.error(error.message)
      return response.status(500).send({
        message: 'There were some problems in getting the lock data.',
      })
    }
  }

  async getKeyMetadata(request: Request, response: Response) {
    try {
      const keyId = request.params.keyId.toLowerCase()
      const lockAddress = Normalizer.ethereumAddress(request.params.lockAddress)
      const network = Number(request.params.network)
      const host = `${request.protocol}://${request.headers.host}`

      const includeProtected = await this.#isKeyOrLockOwner({
        keyId,
        network,
        lockAddress,
        userAddress: request.user?.walletAddress,
      })

      const keyData = await metadataOperations.generateKeyMetadata(
        lockAddress,
        keyId,
        includeProtected,
        host,
        network
      )

      return response.status(200).send(keyData)
    } catch (error) {
      logger.error(error.message)
      return response.status(500).send({
        message: 'There were some problems in getting the key metadata.',
      })
    }
  }

  async updateLockMetadata(request: Request, response: Response) {
    try {
      const lockAddress = Normalizer.ethereumAddress(request.params.lockAddress)
      const network = Number(request.params.network)
      const { metadata } = request.body
      const loggedUserAddress = Normalizer.ethereumAddress(
        request.user!.walletAddress!
      )

      const isLockOwner = await this.web3Service.isLockManager(
        lockAddress,
        loggedUserAddress,
        network
      )

      if (!isLockOwner) {
        return response.status(401).send({
          message: `${loggedUserAddress} is not a lock manager for ${lockAddress} on ${network}`,
        })
      }
      const [updatedLockMetadata, created] = await LockMetadata.upsert(
        {
          address: lockAddress,
          chain: network,
          data: {
            ...metadata,
          },
        },
        {
          returning: true,
        }
      )
      const statusCode = created ? 201 : 204
      return response.status(statusCode).send(updatedLockMetadata.data)
    } catch (error) {
      logger.error(error.message)
      return response.status(500).send({
        message: 'There were some problems in updating the lock metadata.',
      })
    }
  }

  async updateKeyMetadata(request: Request, response: Response) {
    try {
      const keyId = request.params.keyId.toLowerCase()
      const { metadata } = request.body
      const lockAddress = Normalizer.ethereumAddress(request.params.lockAddress)
      const loggedUserAddress = Normalizer.ethereumAddress(
        request.user!.walletAddress
      )
      const network = Number(request.params.network)
      const host = `${request.protocol}://${request.headers.host}`
      const isLockOwner = await this.web3Service.isLockManager(
        lockAddress,
        loggedUserAddress,
        network
      )

      if (!isLockOwner) {
        return response.status(401).send({
          message: 'You are not authorized to update this key.',
        })
      }

      const created = await KeyMetadata.upsert({
        chain: network,
        address: lockAddress,
        id: keyId,
        data: {
          ...metadata,
        },
      })

      const keyData = await metadataOperations.generateKeyMetadata(
        lockAddress,
        keyId,
        isLockOwner,
        host,
        network
      )
      const statusCode = created ? 201 : 204
      return response.status(statusCode).send(keyData)
    } catch (error) {
      logger.error(error.message)
      return response.status(500).send({
        message: 'There were some problems in updating the key metadata.',
      })
    }
  }

  async createUserMetadata(request: Request, response: Response) {
    try {
      const tokenAddress = Normalizer.ethereumAddress(
        request.params.lockAddress
      )
      const userAddress = Normalizer.ethereumAddress(request.params.userAddress)
      const network = Number(request.params.network)
      const metadata = await UserMetadata.parseAsync(request.body.metadata)
      const userData = await UserTokenMetadata.findOne({
        where: {
          userAddress,
          tokenAddress,
          chain: network,
        },
      })

      // If no metadata was set previously, we let anyone set it.
      if (!userData) {
        const newUserData = new UserTokenMetadata()
        newUserData.tokenAddress = tokenAddress
        newUserData.chain = network
        newUserData.userAddress = userAddress
        newUserData.data = {
          userMetadata: {
            ...metadata,
          },
        }
        const createdUserMetadata = await newUserData.save()
        return response.status(201).send(createdUserMetadata.data)
      }

      return response.status(409).send({
        message: 'User metadata already exists.',
      })
    } catch (error) {
      logger.error(error.message)

      if (error instanceof z.ZodError) {
        return response.status(400).send({
          message: 'User metadata is not in the correct form.',
          error: error.format(),
        })
      }

      return response.status(500).send({
        message: 'User metadata could not be added.',
      })
    }
  }

  async updateUserMetadata(request: Request, response: Response) {
    try {
      const tokenAddress = Normalizer.ethereumAddress(
        request.params.lockAddress
      )
      const userAddress = Normalizer.ethereumAddress(request.params.userAddress)
      const loggedUserAddress = Normalizer.ethereumAddress(
        request.user!.walletAddress
      )
      const network = Number(request.params.network)
      const metadata = await UserMetadata.parseAsync(request.body.metadata)

      const isUserMetadataOwner = userAddress === loggedUserAddress

      const isLockOwner = this.web3Service.isLockManager(
        tokenAddress,
        loggedUserAddress,
        network
      )

      const userData = await UserTokenMetadata.findOne({
        where: {
          userAddress,
          tokenAddress,
        },
      })

      if (!userData) {
        return response.status(404).send({
          message: "User metadata doesn't exist.",
        })
      }

      if (!(isLockOwner || isUserMetadataOwner)) {
        return response.status(401).send({
          message:
            'You are not authorized to update user metadata for this key.',
        })
      }

      const [rows, updatedUserMetadata] = await UserTokenMetadata.update(
        {
          data: {
            userMetadata: {
              ...metadata,
            },
          },
        },
        {
          where: {
            tokenAddress,
            userAddress,
            chain: network,
          },
          returning: true,
        }
      )

      if (!rows) {
        return response.status(500).send({
          message: 'Failed to update the user metadata.',
        })
      }
      return response.status(204).send(updatedUserMetadata[0].data)
    } catch (error) {
      logger.error(error.message)

      if (error instanceof z.ZodError) {
        return response.status(400).send({
          message: 'User metadata is not in the correct form.',
          error: error.format(),
        })
      }

      return response.status(500).send({
        message: 'There were some problems in updating user metadata.',
      })
    }
  }

  async createBulkUserMetadata(request: Request, response: Response) {
    try {
      const network = Number(request.params.network)
      const { users } = await BulkUserMetadataBody.parseAsync(request.body)
      const query = users.map((user) => {
        const tokenAddress = Normalizer.ethereumAddress(user.lockAddress)
        const userAddress = Normalizer.ethereumAddress(user.userAddress)
        return {
          [Op.and]: [
            {
              tokenAddress,
            },
            {
              userAddress,
            },
          ],
        }
      })

      const userMetadataResults = await UserTokenMetadata.findAll({
        where: {
          [Op.or]: query,
        },
      })

      if (userMetadataResults.length) {
        return response.status(409).send({
          message: 'User metadata already exists for the following users.',
          users: userMetadataResults.map((user) => {
            return {
              lockAddress: user.tokenAddress,
              userAddress: user.userAddress,
            }
          }),
        })
      }

      const newUsersData = users.map((user) => {
        const { userAddress } = user
        const lockAddress = Normalizer.ethereumAddress(user.lockAddress)
        const tokenAddress = lockAddress
        const metadata = UserMetadata.parse(user.metadata)
        const newUserData = {
          userAddress,
          tokenAddress,
          chain: network,
          data: {
            userMetadata: {
              ...metadata,
            },
          },
        }
        return newUserData
      })

      const items = await UserTokenMetadata.bulkCreate(newUsersData)
      return response.status(201).send({
        result: items,
      })
    } catch (error) {
      logger.error(error.message)

      if (error instanceof z.ZodError) {
        return response.status(400).send({
          message: 'User metadata is not in the correct form.',
          error: error.format(),
        })
      }
      return response.status(500).send({
        message: 'Bulk user metadata could not be added.',
      })
    }
  }
}
