/* eslint-disable */
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: string;
  String: string;
  Boolean: boolean;
  Int: number;
  Float: number;
};

export type Continent = {
  code: Scalars['ID'];
  countries: Array<Country>;
  name: Scalars['String'];
};

export type ContinentFilterInput = {
  code?: InputMaybe<StringQueryOperatorInput>;
};

export type Country = {
  awsRegion: Scalars['String'];
  capital: Maybe<Scalars['String']>;
  code: Scalars['ID'];
  continent: Continent;
  currencies: Array<Scalars['String']>;
  currency: Maybe<Scalars['String']>;
  emoji: Scalars['String'];
  emojiU: Scalars['String'];
  languages: Array<Language>;
  name: Scalars['String'];
  native: Scalars['String'];
  phone: Scalars['String'];
  phones: Array<Scalars['String']>;
  states: Array<State>;
};

export type CountryFilterInput = {
  code?: InputMaybe<StringQueryOperatorInput>;
  continent?: InputMaybe<StringQueryOperatorInput>;
  currency?: InputMaybe<StringQueryOperatorInput>;
};

export type Language = {
  code: Scalars['ID'];
  name: Scalars['String'];
  native: Scalars['String'];
  rtl: Scalars['Boolean'];
};

export type LanguageFilterInput = {
  code?: InputMaybe<StringQueryOperatorInput>;
};

export type Mutation = {
  noop: Scalars['Boolean'];
};

export type Query = {
  __health: Scalars['Boolean'];
  continent: Maybe<Continent>;
  continents: Array<Continent>;
  countries: Array<Country>;
  country: Maybe<Country>;
  language: Maybe<Language>;
  languages: Array<Language>;
};


export type QueryContinentArgs = {
  code: Scalars['ID'];
};


export type QueryContinentsArgs = {
  filter?: InputMaybe<ContinentFilterInput>;
};


export type QueryCountriesArgs = {
  filter?: InputMaybe<CountryFilterInput>;
};


export type QueryCountryArgs = {
  code: Scalars['ID'];
};


export type QueryLanguageArgs = {
  code: Scalars['ID'];
};


export type QueryLanguagesArgs = {
  filter?: InputMaybe<LanguageFilterInput>;
};

export type State = {
  code: Maybe<Scalars['String']>;
  country: Country;
  name: Scalars['String'];
};

export type StringQueryOperatorInput = {
  eq?: InputMaybe<Scalars['String']>;
  in?: InputMaybe<Array<Scalars['String']>>;
  ne?: InputMaybe<Scalars['String']>;
  nin?: InputMaybe<Array<Scalars['String']>>;
  regex?: InputMaybe<Scalars['String']>;
};

export type GetCountryQueryVariables = Exact<{
  countryCode: Scalars['String'];
}>;


export type GetCountryQuery = { country: Array<{ code: string, name: string, capital: string | null }> };


export const GetCountryDocument = {"__meta__":{"operation":"getCountry","type":"query","hash":"8c208c190c0d083e78b031fd38aa317fdf7c3c6a"}} as unknown as DocumentNode<GetCountryQuery, GetCountryQueryVariables>;