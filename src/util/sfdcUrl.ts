/*
 * Copyright (c) 2021, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { URL } from 'url';
import { Env, Duration } from '@salesforce/kit';
import { ensureNumber, ensureArray } from '@salesforce/ts-types';
import { MyDomainResolver } from '../status/myDomainResolver';
import { Logger } from '../logger';
import { Lifecycle } from '../lifecycleEvents';

export function getLoginAudienceCombos(audienceUrl: string, loginUrl: string) {
  const filtered = [
    [loginUrl, loginUrl],
    [SfdcUrl.SANDBOX, SfdcUrl.SANDBOX],
    [SfdcUrl.PRODUCTION, SfdcUrl.PRODUCTION],
    [audienceUrl, audienceUrl],
    [audienceUrl, SfdcUrl.PRODUCTION],
    [audienceUrl, SfdcUrl.SANDBOX],
    [loginUrl, audienceUrl],
    [loginUrl, SfdcUrl.PRODUCTION],
    [loginUrl, SfdcUrl.SANDBOX],
    [SfdcUrl.PRODUCTION, audienceUrl],
    [SfdcUrl.SANDBOX, audienceUrl],
  ].filter(
    ([login, audience]) =>
      !(
        (login === SfdcUrl.PRODUCTION && audience === SfdcUrl.SANDBOX) ||
        (login === SfdcUrl.SANDBOX && audience === SfdcUrl.PRODUCTION)
      )
  );
  const reduced = filtered.reduce((acc, [login, audience]) => {
    const l = new URL(login);
    const a = new URL(audience);
    acc.set(`${l.origin}:${a.origin}`, [login, audience]);
    return acc;
  }, new Map<string, [string, string]>());
  return [...reduced.values()];
}

export class SfdcUrl extends URL {
  /**
   * Salesforce URLs
   */
  public static readonly SANDBOX = 'https://test.salesforce.com';
  public static readonly PRODUCTION = 'https://login.salesforce.com';
  private static readonly cache: Set<string> = new Set();
  private logger!: Logger;

  public constructor(input: string | URL, base?: string | URL) {
    super(input.toString(), base);
    if (this.protocol !== 'https:' && !SfdcUrl.cache.has(this.origin)) {
      SfdcUrl.cache.add(this.origin);
      void Lifecycle.getInstance().emitWarning(`Using insecure protocol: ${this.protocol} on url: ${this.origin}`);
    }
  }

  public static isValidUrl(input: string | URL): boolean {
    try {
      new URL(input.toString());
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns the appropriate jwt audience url for this url
   * Use SFDX_AUDIENCE_URL env var to override the audience url
   *
   * @param createdOrgInstance The Salesforce instance the org was created on. e.g. `cs42`
   * @return {Promise<string>} The audience url
   */
  public async getJwtAudienceUrl(createdOrgInstance?: string): Promise<string> {
    this.logger = await Logger.child('SfdcUrl');
    // environment variable is used as an override
    const envVarVal = new Env().getString('SFDX_AUDIENCE_URL', '');
    if (envVarVal) {
      this.logger.debug(`Audience URL overridden by env var SFDX_AUDIENCE_URL=${envVarVal}`);
      return envVarVal;
    }

    if ((createdOrgInstance && /^gs1/gi.test(createdOrgInstance)) || /(gs1.my.salesforce.com)/gi.test(this.origin)) {
      return 'https://gs1.salesforce.com';
    }

    return SfdcUrl.PRODUCTION;
  }

  /**
   * Tests whether this url contains a Salesforce owned domain
   *
   * @return {boolean} true if this is a salesforce domain
   */
  public isSalesforceDomain(): boolean {
    // Source https://help.salesforce.com/articleView?id=000003652&type=1
    const allowlistOfSalesforceDomainPatterns: string[] = [
      '.cloudforce.com',
      '.content.force.com',
      '.force.com',
      '.salesforce.com',
      '.salesforceliveagent.com',
      '.secure.force.com',
      'crmforce.mil',
    ];

    const allowlistOfSalesforceHosts: string[] = ['developer.salesforce.com', 'trailhead.salesforce.com'];

    return allowlistOfSalesforceDomainPatterns.some((pattern) => {
      return this.hostname.endsWith(pattern) || allowlistOfSalesforceHosts.includes(this.hostname);
    });
  }

  /**
   * Tests whether this url is an internal Salesforce domain
   *
   * @returns {boolean} true if this is an internal domain
   */
  public isInternalUrl(): boolean {
    const INTERNAL_URL_PARTS = [
      '.vpod.',
      'stm.salesforce.com',
      'stm.force.com',
      '.blitz.salesforce.com',
      '.stm.salesforce.ms',
      '.pc-rnd.force.com',
      '.pc-rnd.salesforce.com',
    ];
    return (
      this.origin.startsWith('https://gs1.') ||
      this.isLocalUrl() ||
      INTERNAL_URL_PARTS.some((part) => this.origin.includes(part))
    );
  }

  /**
   * Tests whether this url runs on a local machine
   *
   * @returns {boolean} true if this is a local machine
   */
  public isLocalUrl(): boolean {
    const LOCAL_PARTS = ['localhost.sfdcdev.', '.internal.'];
    return LOCAL_PARTS.some((part) => this.origin.includes(part));
  }

  public toLightningDomain(): string {
    if (this.origin.endsWith('.my.salesforce.mil')) {
      return this.origin.replace('.my.salesforce.mil', '.lightning.crmforce.mil');
    }
    // enhanced domains
    if (this.origin.endsWith('sandbox.my.salesforce.com')) {
      return this.origin.replace('sandbox.my.salesforce.com', 'sandbox.lightning.force.com');
    }

    // all non-mil domains
    return `https://${ensureArray(/https?:\/\/([^.]*)/.exec(this.origin))
      .slice(1, 2)
      .pop()}.lightning.force.com`;
  }
  /**
   * Tests whether this url has the lightning domain extension
   * This method that performs the dns lookup of the host. If the lookup fails the internal polling (1 second), client will try again until timeout
   * If SFDX_DOMAIN_RETRY environment variable is set (number) it overrides the default timeout duration (240 seconds)
   *
   * @returns {Promise<true | never>} The resolved ip address or never
   * @throws {@link SfError} If can't resolve DNS.
   */
  public async checkLightningDomain(): Promise<true | never> {
    const quantity = ensureNumber(new Env().getNumber('SFDX_DOMAIN_RETRY', 240));
    const timeout = new Duration(quantity, Duration.Unit.SECONDS);

    if (this.isInternalUrl() || timeout.seconds === 0) {
      return true;
    }

    const resolver = await MyDomainResolver.create({
      url: new URL(this.toLightningDomain()),
      timeout,
      frequency: new Duration(1, Duration.Unit.SECONDS),
    });

    await resolver.resolve();
    return true;
  }

  /**
   * Method that performs the dns lookup of the host. If the lookup fails the internal polling (1 second), client will try again until timeout
   * If SFDX_DOMAIN_RETRY environment variable is set (number) it overrides the default timeout duration (240 seconds)
   *
   * @returns the resolved ip address.
   * @throws {@link SfError} If can't resolve DNS.
   */
  public async lookup(): Promise<string> {
    const quantity = ensureNumber(new Env().getNumber('SFDX_DOMAIN_RETRY', 240));
    const timeout = new Duration(quantity, Duration.Unit.SECONDS);
    const resolver = await MyDomainResolver.create({
      url: new URL(this.origin),
      timeout,
      frequency: new Duration(1, Duration.Unit.SECONDS),
    });
    return resolver.resolve();
  }

  /**
   * Tests whether this url is a sandbox url
   *
   * @Deprecated - identification of a sandbox instance by URL alone is not deterministic
   * @param createdOrgInstance The Salesforce instance the org was created on. e.g. `cs42`
   * @returns {boolean}
   */
  // TODO: how to get rid of this?
  public isSandboxUrl(createdOrgInstance?: string): boolean {
    return (
      (createdOrgInstance && /^cs|s$/gi.test(createdOrgInstance)) ||
      this.origin.endsWith('sandbox.my.salesforce.mil') ||
      /sandbox\.my\.salesforce\.com/gi.test(this.origin) || // enhanced domains >= 230
      /(cs[0-9]+(\.my|)\.salesforce\.com)/gi.test(this.origin) || // my domains on CS instance OR CS instance without my domain
      /(cs[0-9]+\.force\.com)/gi.test(this.origin) || // sandboxes have cnames like cs123.force.com
      /(\w+--\w+\.my\.salesforce\.com)/gi.test(this.origin) || // sandboxes myDomain like foo--bar.my.salesforce.com
      /([a-z]{3}[0-9]+s\.sfdc-.+\.salesforce\.com)/gi.test(this.origin) || // falcon sandbox ex: usa2s.sfdc-whatever.salesforce.com
      /([a-z]{3}[0-9]+s\.sfdc-.+\.force\.com)/gi.test(this.origin) || // falcon sandbox ex: usa2s.sfdc-whatever.force.com
      this.hostname === 'test.salesforce.com'
    );
  }

  /**
   * Test whether this url represents a lightning domain
   *
   * @returns {boolean} true if this domain is a lightning domain
   */
  public isLightningDomain(): boolean {
    return /\.lightning\.force\.com/.test(this.origin) || /\.lightning\.crmforce\.mil/.test(this.origin);
  }
}
