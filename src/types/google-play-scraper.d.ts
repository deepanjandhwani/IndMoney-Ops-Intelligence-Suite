declare module "google-play-scraper" {
  export type ReviewsOptions = {
    appId: string;
    country?: string;
    lang?: string;
    num?: number;
    sort?: number;
  };

  export type Review = {
    id?: string;
    text?: string;
    content?: string;
    score?: number;
    date?: Date | string | number;
    at?: Date | string | number;
  };

  export type ReviewsResponse = {
    data: Review[];
    nextPaginationToken: string | null;
  };

  const googlePlayScraper: {
    reviews: (options: ReviewsOptions) => Promise<ReviewsResponse>;
    sort: {
      NEWEST: number;
    };
  };

  export default googlePlayScraper;
}
