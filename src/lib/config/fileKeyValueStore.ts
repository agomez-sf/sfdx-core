/*
 * Copyright (c) 2018, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root  or https://opensource.org/licenses/BSD-3-Clause
 */
import { constants as fsConstants } from 'fs';
import * as _ from 'lodash';
import {Config, ConfigOptions} from './config';
import Global from '../global';

const _set = (aliases, group, alias, property) => {
    if (_.isNil(aliases[group])) {
        aliases[group] = {};
    }

    if (_.isUndefined(property)) {
        delete aliases[group][alias];
    } else {
        const value = _.entries(aliases[group]).find((val) => val[1] === property);

        if (value) {
            delete aliases[group][value[0]];
        }

        aliases[group][alias] = property;
    }
    return aliases;
};

export interface KeyValueStoreConfigOptions extends ConfigOptions {
    defaultGroup: string;
}

/**
 * Manages access to a key value store in the global .sfdx folder under <fileStoreName>.
 *
 * All key value pairs are stored under a group.
 *
 * @private
 */
export class KeyValueStore extends Config {

    /**
     *
     * @param {KeyValueStoreConfigOptions} options
     * @returns {Promise}
     */
    public static async create<T extends Config>(this: { new(): T }, options: KeyValueStoreConfigOptions): Promise<T> {

        const store: T =  await super.create(options) as T;
        if (!(await store.access(fsConstants.R_OK))) {
            await store.write(JSON.parse(`{ "${options.defaultGroup}": {} }`));
        }
        return store as T;
    }

    public static getDefaultOptions(filename: string, defaultGroup: string): KeyValueStoreConfigOptions {
        return {
            filename,
            defaultGroup,
            filePath: Global.STATE_FOLDER
        };
    }

    /**
     * Set a group of aliases in a bulk save.
     * @param {object} keyAndValues An object representing the aliases to set.
     * @param {string} group The group the property belongs to. Defaults to 'default'.
     * @returns {Promise<object>} The new property that was saved.
     */
    public async updateValues(newAliases: object, group: string = 'default'): Promise<object> {
        const aliases = await this.readJSON();
        _.forEach(newAliases, (val, key) => _set(aliases, group, key, val));
        await this.write(aliases);
        return newAliases;
    }

    /**
     * Delete an alias from a group
     * @param {string} alias The name of the alias to delete
     * @param {string} group The group the alias belongs to. Defaults to 'default'.
     * @returns {Promise<void>} The promise resolved when the alias is deleted
     */
    public async remove(alias: string, group: string = 'default'): Promise<void> {
        return await this.update(alias, undefined, group);
    }

    /**
     * Set an alias on a group
     * @param {string} alias The name of the alias to set
     * @param {string} property The value of the alias
     * @param {string} group The group the alias belongs to. Defaults to 'default'.
     * @returns {Promise<void>} The promise resolved when the alias is set.
     */
    public async update(alias: string , property: string | number, group: string = 'default'): Promise<void> {
        const aliases = await this.readJSON();
        _set(aliases, group, alias, property);
        await this.write(aliases);
    }

    /**
     * Unset one or more aliases on a group
     * @param {string[]} aliases The names of the aliases to unset
     * @param {string} group The group the alias belongs to. Defaults to 'default'.
     * @returns {Promise<void>} The promise resolved when the aliases are unset
     */
    public async unset(aliasesToUnset: string[], group: string = 'default'): Promise<void> {
        const aliases = await this.readJSON();
        aliases[group] = _.omit(aliases[group], aliasesToUnset);
        await this.write(aliases);
    }

    /**
     * Get an alias from a group
     * @param {string} alias The name of the alias to get
     * @param {string} group The group the alias belongs to. Defaults to 'default'.
     * @returns {Promise<string>} The promise resolved when the alias is retrieved
     */
    public async fetch(alias: string, group: string = 'default'): Promise<string> {
        const aliases = await this.list(group);
        const result = aliases[alias];
        return result;
    }

    /**
     * Get all alias from a group
     * @param {string} group The group of aliases to retrieve. Defaults to 'default'.
     * @returns {Promise<object>} The promise resolved when the aliases are retrieved
     */
    public async list(group: string = 'default'): Promise<object> {
        const aliases = await this.readJSON();
        return aliases[group] || {};
    }

    /**
     * Get an alias from a group by value
     * @param {string} value The value of the alias to match
     * @param {string} group The group the alias belongs to. Defaults to 'default'.
     * @returns {Promise<string>} The promise resolved when the alias is retrieved
     */
    public async byValue(value: string, group: string = 'default'): Promise<string> {
        const aliases = await this.list(group);
        return Object.keys(aliases).find((key) => aliases[key] === value);
    }
}