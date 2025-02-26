import React, { useState, useContext, useEffect } from 'react'
import { WalletServiceContext } from '../../../utils/withWalletService'
import { ToastHelper } from '../../helpers/toast.helper'
import InlineModal from '../InlineModal'
import Loading from '../Loading'

export interface ICancelAndRefundProps {
  active: boolean
  lock: any
  dismiss: () => void
  account: string
  currency: string
  keyId: string
}

export const CancelAndRefundModal: React.FC<ICancelAndRefundProps> = ({
  active,
  lock,
  dismiss,
  account: owner,
  currency,
  keyId,
}) => {
  const [loading, setLoading] = useState(false)
  const [loadingAmount, setLoadingAmount] = useState(false)
  const [refundAmount, setRefundAmount] = useState<number | null>(null)
  const walletService = useContext(WalletServiceContext)
  const { address: lockAddress, tokenAddress } = lock ?? {}

  useEffect(() => {
    if (!active) return
    getRefundAmount()
  }, [active])

  const getRefundAmount = async () => {
    setLoadingAmount(true)
    const params = {
      lockAddress,
      owner,
      tokenAddress,
      tokenId: keyId,
    }
    const totalToRefund = await walletService.getCancelAndRefundValueFor(params)
    setRefundAmount(totalToRefund)
    setLoadingAmount(false)
  }

  const onCloseCallback = () => {
    if (typeof dismiss === 'function') dismiss()
    setLoading(false)
  }

  const onCancelAndRefund = async () => {
    setLoading(true)

    const params = {
      lockAddress,
      tokenId: keyId,
    }

    try {
      await walletService.cancelAndRefund(params)
      onCloseCallback()
      ToastHelper.success('Key cancelled and successfully refunded.')
      // reload page to show updated list of keys
      setTimeout(() => {
        window.location.reload()
      }, 2000)
    } catch (err: any) {
      onCloseCallback()
      ToastHelper.error(
        err?.error?.message ??
          err?.message ??
          'There was an error in refund process. Please try again.'
      )
    }
  }

  if (!lock) return <span>No lock selected</span>
  return (
    <InlineModal active={active} dismiss={onCloseCallback}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
        }}
      >
        {loadingAmount ? (
          <Loading />
        ) : (
          <>
            <h3 className="text-black-500">Cancel and Refund</h3>
            <p className="pt-2 text-sm">
              {`${refundAmount} ${currency} will be refunded, Do you want to proceed?`}
            </p>
          </>
        )}
        <button
          className="bg-gray-200 rounded px-2 py-1 text-sm mt-4 flex justify-center disabled:opacity-50 w-100"
          type="button"
          onClick={onCancelAndRefund}
          disabled={loading || loadingAmount}
        >
          {loading ? (
            <Loading size={20} />
          ) : (
            <span className="ml-2">Confirm</span>
          )}
        </button>
      </div>
    </InlineModal>
  )
}
