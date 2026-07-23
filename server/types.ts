// Shared types across all three source adapters. One unified Article shape —
// `pmid` doubles as the generic record key (PMID / ERIC accession / NCT id)
// so pool, harvest, and list plumbing work unchanged across sources.

export type Source = "pubmed" | "eric" | "trials";

export interface Article {
  src: Source;
  pmid: string;
  doi: string;
  title: string;
  authors: string[];
  year: string;
  journal: string;
  keywords: string[];
  mesh: string[];
  eric: string[];
  abstract: string;
  pubtypes: string[];
  url: string;
  peerReviewed?: boolean;
  ctStatus?: string;
  hasResults?: boolean;
}

export interface SearchResult {
  articles: Article[];
  total: number;
  error?: string;
  nextPageToken?: string | null; // trials only
}

export interface VocabRow {
  id?: string;   // MeSH descriptor id, when known
  label: string;
  via?: string | null; // the synonym/entry-term that matched, if not a direct label match
}

export interface VocabDetails {
  scopeNote: string; // MeSH only
  terms: string[];   // entry terms (MeSH) / Use-For synonyms (ERIC)
  bt: string[];       // broader
  nt: string[];       // narrower
}

export interface AdvField {
  label: string;
  tag: string;
}
