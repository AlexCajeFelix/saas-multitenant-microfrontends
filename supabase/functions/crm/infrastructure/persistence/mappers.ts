import { Email, Mapper, Money } from "../../../_shared/mod.ts";
import { Activity, Company, Contact, Deal } from "../../domain/entities.ts";
import { ActivityKind, DealStatus, PersonName, PipelineStage } from "../../domain/value-objects.ts";

export interface CompanyRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  website: string | null;
  phone: string | null;
  address: Record<string, unknown> | null;
  owner_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export class CompanyMapper extends Mapper<Company, CompanyRow> {
  override toDomain(row: CompanyRow): Company {
    return Company.restore(row.id, {
      tenantId: row.tenant_id,
      name: row.name,
      domain: row.domain,
      industry: row.industry,
      size: row.size,
      website: row.website,
      phone: row.phone,
      address: row.address ?? {},
      ownerId: row.owner_id,
      createdBy: row.created_by,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  }

  override toRow(company: Company): Record<string, unknown> {
    return {
      id: company.id,
      tenant_id: company.tenantId,
      name: company.name,
      domain: company.domain,
      industry: company.industry,
      size: company.size,
      website: company.website,
      phone: company.phone,
      address: company.address,
      owner_id: company.ownerId,
      created_by: company.createdBy,
    };
  }
}

export interface ContactRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  company_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  owner_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export class ContactMapper extends Mapper<Contact, ContactRow> {
  override toDomain(row: ContactRow): Contact {
    return Contact.restore(row.id, {
      tenantId: row.tenant_id,
      companyId: row.company_id,
      name: PersonName.create(row.first_name, row.last_name ?? ""),
      email: row.email ? Email.create(row.email) : null,
      phone: row.phone,
      jobTitle: row.job_title,
      ownerId: row.owner_id,
      createdBy: row.created_by,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  }

  override toRow(contact: Contact): Record<string, unknown> {
    return {
      id: contact.id,
      tenant_id: contact.tenantId,
      company_id: contact.companyId,
      first_name: contact.firstName,
      last_name: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      job_title: contact.jobTitle,
      owner_id: contact.ownerId,
      created_by: contact.createdBy,
    };
  }
}

export interface ActivityRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  deal_id: string;
  kind: string;
  subject: string;
  notes: string;
  occurred_at: string;
  created_by: string | null;
  created_at: string;
}

export class ActivityMapper extends Mapper<Activity, ActivityRow> {
  override toDomain(row: ActivityRow): Activity {
    return Activity.restore(row.id, {
      tenantId: row.tenant_id,
      dealId: row.deal_id,
      kind: ActivityKind.create(row.kind),
      subject: row.subject,
      notes: row.notes ?? "",
      occurredAt: new Date(row.occurred_at),
      createdBy: row.created_by,
      createdAt: new Date(row.created_at),
    });
  }

  override toRow(activity: Activity): Record<string, unknown> {
    return {
      id: activity.id,
      tenant_id: activity.tenantId,
      deal_id: activity.dealId,
      kind: activity.kind,
      subject: activity.subject,
      notes: activity.notes,
      occurred_at: activity.occurredAt.toISOString(),
      created_by: activity.createdBy,
    };
  }
}

export interface DealRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  title: string;
  company_id: string | null;
  contact_id: string | null;
  stage_key: string;
  status: string;
  amount_cents: number;
  currency: string;
  probability: number;
  expected_close_date: string | null;
  closed_at: string | null;
  lost_reason: string | null;
  owner_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  activities?: ActivityRow[] | null;
}

export class DealMapper extends Mapper<Deal, DealRow> {
  private readonly activityMapper = new ActivityMapper();

  override toDomain(row: DealRow): Deal {
    return Deal.restore(row.id, {
      tenantId: row.tenant_id,
      title: row.title,
      companyId: row.company_id,
      contactId: row.contact_id,
      stageKey: row.stage_key,
      status: DealStatus.create(row.status),
      amount: Money.fromCents(Number(row.amount_cents), row.currency),
      probability: row.probability,
      expectedCloseDate: row.expected_close_date ? new Date(row.expected_close_date) : null,
      closedAt: row.closed_at ? new Date(row.closed_at) : null,
      lostReason: row.lost_reason,
      ownerId: row.owner_id,
      createdBy: row.created_by,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      activities: this.activityMapper.toDomainList(row.activities ?? []),
    });
  }

  override toRow(deal: Deal): Record<string, unknown> {
    return {
      id: deal.id,
      tenant_id: deal.tenantId,
      title: deal.title,
      company_id: deal.companyId,
      contact_id: deal.contactId,
      stage_key: deal.stageKey,
      status: deal.status.value,
      amount_cents: deal.amount.cents,
      currency: deal.amount.currency,
      probability: deal.probability,
      expected_close_date: deal.expectedCloseDate
        ? deal.expectedCloseDate.toISOString().slice(0, 10)
        : null,
      closed_at: deal.closedAt?.toISOString() ?? null,
      lost_reason: deal.lostReason,
      owner_id: deal.ownerId,
      created_by: deal.createdBy,
    };
  }
}

export interface PipelineStageRow extends Record<string, unknown> {
  key: string;
  name: string;
  position: number;
  probability: number;
  is_won: boolean;
  is_lost: boolean;
}

export class PipelineStageMapper extends Mapper<PipelineStage, PipelineStageRow> {
  override toDomain(row: PipelineStageRow): PipelineStage {
    return PipelineStage.create({
      key: row.key,
      name: row.name,
      position: row.position,
      probability: row.probability,
      isWon: row.is_won,
      isLost: row.is_lost,
    });
  }

  override toRow(stage: PipelineStage): Record<string, unknown> {
    return {
      key: stage.key,
      name: stage.name,
      position: stage.position,
      probability: stage.probability,
      is_won: stage.isWon,
      is_lost: stage.isLost,
    };
  }
}
