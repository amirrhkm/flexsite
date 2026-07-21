#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SiteStack } from '../lib/site-stack';

const app = new cdk.App();

new SiteStack(app, 'Site', {
  env: {
    account: "761018890563",
    region: "ap-southeast-1",
  },
});
