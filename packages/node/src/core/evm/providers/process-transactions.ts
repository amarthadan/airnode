import { getGasPrice } from '../gas-prices';
import * as contracts from '../contracts';
import * as logger from '../../logger';
import * as nonces from '../../requests/nonces';
import * as transactions from '../transactions';
import * as state from '../../providers/state';
import * as utils from '../utils';
import { ProviderState } from '../../../types';

export async function processTransactions(initialState: ProviderState) {
  // =================================================================
  // STEP 1: Assign nonces to processable requests
  // =================================================================
  const walletDataByIndexWithNonces = nonces.assign(initialState);
  const state1 = state.update(initialState, { walletDataByIndex: walletDataByIndexWithNonces });

  // =================================================================
  // STEP 2: Get the latest gas price
  // =================================================================
  const gasPriceOptions = {
    address: contracts.GasPriceFeed.addresses[state1.config.chainId],
    provider: state1.provider,
  };
  const [gasPriceLogs, gasPrice] = await getGasPrice(gasPriceOptions);
  logger.logPendingMessages(state1.config.name, gasPriceLogs);

  const gweiPrice = utils.weiToGwei(gasPrice);
  logger.logProviderJSON(state1.config.name, 'INFO', `Gas price set to ${gweiPrice} Gwei`);
  const state2 = state.update(state1, { gasPrice });

  // =================================================================
  // STEP 3: Submit transactions for each wallet
  // =================================================================
  const receipts = await transactions.submit(state2);
  const successfulReceipts = receipts.filter((receipt) => !!receipt.data);
  successfulReceipts.forEach((receipt) => {
    logger.logProviderJSON(
      state2.config.name,
      'INFO',
      `Transaction:${receipt.data!.hash} submitted for Request:${receipt.id}`
    );
  });

  return receipts;
}