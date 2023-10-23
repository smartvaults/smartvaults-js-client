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