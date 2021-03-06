/* eslint-disable no-use-before-define */

import { ObjectTypeComposer, ObjectTypeComposerArgumentConfigMap } from 'graphql-compose';
import type { Model } from 'mongoose';
import GraphQLMongoID from '../../types/mongoid';
import { isObject, toMongoFilterDottedObject, getIndexedFieldNamesForGraphQL } from '../../utils';
import type { ExtendedResolveParams } from '../index';
import { FilterOperatorsOpts, addFilterOperators, processFilterOperators } from './filterOperators';
import type { AliasesMap } from './aliases';
import { makeFieldsRecursiveNullable } from '../../utils/makeFieldsRecursiveNullable';

export type FilterHelperArgsOpts = {
  prefix?: string;
  suffix?: string;
  isRequired?: boolean;
  onlyIndexed?: boolean;
  requiredFields?: string | string[];
  operators?: FilterOperatorsOpts | false;
  removeFields?: string | string[];
};

// for merging, discriminators merge-able only
export const getFilterHelperArgOptsMap = () => ({
  // filterTypeName? : 'string'
  isRequired: 'boolean',
  onlyIndexed: 'boolean',
  requiredFields: ['string', 'string[]'],
  operators: ['FilterOperatorsOptsMap', 'boolean'],
  removeFields: ['string', 'string[]'],
});

export const filterHelperArgs = (
  typeComposer: ObjectTypeComposer<any, any>,
  model: Model<any>,
  opts?: FilterHelperArgsOpts
): ObjectTypeComposerArgumentConfigMap => {
  if (!(typeComposer instanceof ObjectTypeComposer)) {
    throw new Error('First arg for filterHelperArgs() should be instance of ObjectTypeComposer.');
  }

  if (!model || !model.modelName || !model.schema) {
    throw new Error('Second arg for filterHelperArgs() should be instance of MongooseModel.');
  }

  if (!opts) {
    throw new Error('You should provide non-empty options.');
  }

  const removeFields = [];
  if (opts.removeFields) {
    if (Array.isArray(opts.removeFields)) {
      removeFields.push(...opts.removeFields);
    } else {
      removeFields.push(opts.removeFields);
    }
  }

  if (opts.onlyIndexed) {
    const indexedFieldNames = getIndexedFieldNamesForGraphQL(model);
    Object.keys(typeComposer.getFields()).forEach((fieldName) => {
      if (indexedFieldNames.indexOf(fieldName) === -1) {
        removeFields.push(fieldName);
      }
    });
  }

  const { prefix, suffix } = opts;
  const filterTypeName: string = `${prefix}${typeComposer.getTypeName()}${suffix}`;
  const itc = typeComposer.getInputTypeComposer().clone(filterTypeName);

  makeFieldsRecursiveNullable(itc, { prefix, suffix });

  itc.addFields({
    _ids: [GraphQLMongoID],
  });

  itc.removeField(removeFields);

  if (opts.requiredFields) {
    itc.makeFieldNonNull(opts.requiredFields);
  }

  if (itc.getFieldNames().length === 0) {
    return {};
  }

  addFilterOperators(itc, model, opts);

  return {
    filter: {
      type: opts.isRequired ? itc.getTypeNonNull() : itc,
      description: opts.onlyIndexed ? 'Filter only by indexed fields' : 'Filter by fields',
    },
  };
};

export function filterHelper(
  resolveParams: ExtendedResolveParams,
  aliases: AliasesMap | false
): void {
  const filter = resolveParams.args && resolveParams.args.filter;
  if (filter && typeof filter === 'object' && Object.keys(filter).length > 0) {
    const modelFields = (resolveParams.query as any)?.schema?.paths;

    const { _ids, ...filterFields } = filter;
    if (_ids && Array.isArray(_ids)) {
      // eslint-disable-next-line
      resolveParams.query = resolveParams.query.where({ _id: { $in: _ids } });
    }
    processFilterOperators(filterFields);
    const clearedFilter: Record<string, any> = {};
    Object.keys(filterFields).forEach((key) => {
      if (modelFields[key] || key.indexOf('$') === 0) {
        clearedFilter[key] = filterFields[key];
      } else if (aliases && aliases?.[key]) {
        clearedFilter[aliases[key]] = filterFields[key];
      }
    });
    if (Object.keys(clearedFilter).length > 0) {
      // eslint-disable-next-line
      resolveParams.query = resolveParams.query.where(toMongoFilterDottedObject(clearedFilter));
    }
  }

  if (isObject(resolveParams.rawQuery)) {
    // eslint-disable-next-line
    resolveParams.query = resolveParams.query.where(resolveParams.rawQuery);
  }
}
