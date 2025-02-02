import { writeFileSync } from 'fs';
import { join } from 'path';
import { Config, LocalOrCloudProvider } from '@api3/airnode-node';
import { format } from 'prettier';
import {
  cliPrint,
  getDeployedContract,
  readChainId,
  readIntegrationInfo,
  SameOrCrossChain,
  getExistingAirnodeRrpV0,
} from '../src';
import { version as packageVersion } from '../package.json';

export const createCloudProviderConfiguration = (generateExampleFile: boolean): LocalOrCloudProvider => {
  if (generateExampleFile) {
    return {
      type: 'local',
    };
  }

  const integrationInfo = readIntegrationInfo();
  const airnodeType = integrationInfo.airnodeType;

  switch (airnodeType) {
    case 'aws':
      return {
        type: airnodeType,
        region: 'us-east-1',
        disableConcurrencyReservations: true,
      };
    case 'local':
      return {
        type: airnodeType,
      };
    case 'gcp': {
      return {
        type: airnodeType,
        region: 'us-east1',
        projectId: integrationInfo.gcpProjectId!,
        disableConcurrencyReservations: true,
      };
    }
  }
};

export const getAirnodeRrpAddress = async (generateExampleFile: boolean, chain = SameOrCrossChain.same) => {
  if (generateExampleFile) return '0x5FbDB2315678afecb367f032d93F642f64180aa3';

  if (chain === SameOrCrossChain.cross) {
    const crossChainNetwork = readIntegrationInfo().crossChainNetwork!;
    // localhost requires lookup with getDeployedContract below
    if (crossChainNetwork !== 'localhost') {
      return getExistingAirnodeRrpV0(crossChainNetwork);
    }
  }
  const airnodeRrp = await getDeployedContract('@api3/airnode-protocol/contracts/rrp/AirnodeRrpV0.sol');
  return airnodeRrp.address;
};

export const getChainId = async (generateExampleFile: boolean, chain = SameOrCrossChain.same) =>
  (generateExampleFile ? 31337 : await readChainId(chain)).toString();

export const createNodeVersion = () => {
  return packageVersion;
};

export const generateConfigFile = (dirname: string, config: Config, generateExampleFile: boolean) => {
  const filename = generateExampleFile ? 'config.example.json' : 'config.json';
  const formattedConfig = format(JSON.stringify(config, null, 2), { parser: 'json', printWidth: 120 });
  writeFileSync(join(dirname, filename), formattedConfig);

  cliPrint.info(`A '${filename}' has been created.`);
};
