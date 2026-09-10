import type { Page, PageRequest } from "../../_shared/mod.ts";
import type { Company, Contact, Deal } from "./entities.ts";
import type { Pipeline } from "./value-objects.ts";

export interface CompanyFilter {
  search?: string;
  ownerId?: string;
}

export interface ContactFilter {
  search?: string;
  companyId?: string;
  ownerId?: string;
}

export interface DealFilter {
  status?: string;
  stageKey?: string;
  companyId?: string;
  ownerId?: string;
  search?: string;
}

export interface CompanyRepository {
  getById(id: string): Promise<Company>;
  findById(id: string): Promise<Company | null>;
  search(filter: CompanyFilter, page: PageRequest): Promise<Page<Company>>;
  insert(company: Company): Promise<Company>;
  update(company: Company): Promise<Company>;
  deleteById(id: string): Promise<void>;
}

export interface ContactRepository {
  getById(id: string): Promise<Contact>;
  findById(id: string): Promise<Contact | null>;
  search(filter: ContactFilter, page: PageRequest): Promise<Page<Contact>>;
  insert(contact: Contact): Promise<Contact>;
  update(contact: Contact): Promise<Contact>;
  deleteById(id: string): Promise<void>;
}

/** O repositorio grava a raiz e as atividades pendentes na mesma operacao. */
export interface DealRepository {
  getById(id: string, withActivities?: boolean): Promise<Deal>;
  findById(id: string): Promise<Deal | null>;
  search(filter: DealFilter, page: PageRequest): Promise<Page<Deal>>;
  insert(deal: Deal): Promise<Deal>;
  save(deal: Deal): Promise<Deal>;
}

export interface PipelineStageSummary {
  stageKey: string;
  stageName: string;
  position: number;
  dealsCount: number;
  totalCents: number;
  weightedCents: number;
}

export interface PipelineRepository {
  load(tenantId: string): Promise<Pipeline>;
  summary(tenantId: string): Promise<PipelineStageSummary[]>;
}
