import { Kind } from "nostr-tools";
import { SmartVaultsKind } from "../enum";

export type PaginationOpts = {
  since?: Date | number;
  until?: Date | number;
  limit?: number;
};

export type DatedRate = {
  date: Date,
  rate: number
}

export type BitcoinUnit = 'SAT' | 'BTC';

export type singleKindFilterParams = {
  authors?: string | string[],
  ids?: string | string[],
  pubkeys?: string | string[],
  events?: string | string[],
  kind?: SmartVaultsKind | Kind,
  paginationOpts?: PaginationOpts
  identifiers?: string | string[],
}