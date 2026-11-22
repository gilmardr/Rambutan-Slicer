import assert from 'node:assert/strict';
import test from 'node:test';
import { isGithubRepoHost, isInlinableGithubAssetUrl } from './assetUrlPolicy';

test('repository host check accepts only github.com', () => {
  assert.equal(isGithubRepoHost('github.com'), true);
  assert.equal(isGithubRepoHost('www.github.com'), true);
  assert.equal(isGithubRepoHost('GitHub.com'), true);
  assert.equal(isGithubRepoHost('evilgithub.com'), false);
  assert.equal(isGithubRepoHost('github.com.evil.example'), false);
  assert.equal(isGithubRepoHost('gist.github.com'), false);
});

test('inlined preset images must be HTTPS on a GitHub host', () => {
  assert.equal(isInlinableGithubAssetUrl('https://raw.githubusercontent.com/o/r/main/assets/p.png'), true);
  assert.equal(isInlinableGithubAssetUrl('https://user-images.githubusercontent.com/1/p.png'), true);
  assert.equal(isInlinableGithubAssetUrl('https://github.com/o/r/raw/main/p.png'), true);

  assert.equal(isInlinableGithubAssetUrl('http://raw.githubusercontent.com/o/r/main/p.png'), false);
  assert.equal(isInlinableGithubAssetUrl('https://localhost/p.png'), false);
  assert.equal(isInlinableGithubAssetUrl('https://127.0.0.1/p.png'), false);
  assert.equal(isInlinableGithubAssetUrl('http://169.254.169.254/latest/meta-data'), false);
  assert.equal(isInlinableGithubAssetUrl('https://evilgithubusercontent.com/p.png'), false);
  assert.equal(isInlinableGithubAssetUrl('https://raw.githubusercontent.com.evil.example/p.png'), false);
  assert.equal(isInlinableGithubAssetUrl('https://raw.githubusercontent.com:8443/p.png'), false);
  assert.equal(isInlinableGithubAssetUrl('https://user@raw.githubusercontent.com/p.png'), false);
  assert.equal(isInlinableGithubAssetUrl('not a url'), false);
});
