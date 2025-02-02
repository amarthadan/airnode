import sodium from 'libsodium-wrappers';
import { Octokit } from '@octokit/core';
import { go } from '@api3/promise-utils';
import { logger } from '@api3/airnode-utilities';

const OWNER = 'api3dao';
const REPOSITORY = 'airnode';

const toggleMerge = async (flag: boolean) => {
  logger.log(`Setting 'ENABLE_MERGE' flag to '${flag}' for repository '${OWNER}/${REPOSITORY}'`);

  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    throw new Error('Missing GitHub token');
  }

  const octokit = new Octokit({
    auth: githubToken,
  });

  const goPubKey = await go(() =>
    octokit.request(`GET /repos/${OWNER}/${REPOSITORY}/actions/secrets/public-key`, {
      owner: OWNER,
      repo: REPOSITORY,
    })
  );
  if (!goPubKey.success) {
    throw new Error(`Can't obtain GitHub repository public key: ${goPubKey.error}`);
  }

  const repositoryPublicKey = goPubKey.data.data.key as string;
  const repositoryPublicKeyId = goPubKey.data.data.key_id as string;

  logger.log(`Repository public key: ${repositoryPublicKey} with ID ${repositoryPublicKeyId}`);

  const goSodium = await go(() => sodium.ready);
  if (!goSodium.success) {
    throw new Error(`Can't load the sodium encryption library: ${goSodium.error}`);
  }

  // Convert Secret & Base64 key to Uint8Array.
  const binKey = sodium.from_base64(repositoryPublicKey, sodium.base64_variants.ORIGINAL);
  const binSecret = sodium.from_string(`${flag}`);

  // Encrypt the secret using LibSodium
  const encSecret = sodium.crypto_box_seal(binSecret, binKey);

  // Convert encrypted Uint8Array to Base64
  const base64Secret = sodium.to_base64(encSecret, sodium.base64_variants.ORIGINAL);

  const goSecret = await go(() =>
    octokit.request(`PUT /repos/${OWNER}/${REPOSITORY}/actions/secrets/ENABLE_MERGE`, {
      owner: OWNER,
      repo: REPOSITORY,
      secret_name: 'ENABLE_MERGE',
      encrypted_value: base64Secret,
      key_id: repositoryPublicKeyId,
    })
  );
  if (!goSecret.success) {
    throw new Error(`Can't update GitHub repository secret: ${goSecret.error}`);
  }
};

export const enableMerge = () => toggleMerge(true);
export const disableMerge = () => toggleMerge(false);
