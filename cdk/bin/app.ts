#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SiteStack } from '../lib/site-stack';

const app = new cdk.App();

// Account comes from the ambient credentials, so it is never committed. The npm
// deploy/destroy scripts pin AWS_PROFILE (overridable) so "which account" stays
// deterministic — without that, a stray profile would silently deploy elsewhere.
// Region stays pinned: not sensitive, and the always-free tier maths assumes it.
new SiteStack(app, 'Site', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'ap-southeast-1',
  },
});
