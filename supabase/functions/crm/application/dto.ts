import { V } from "../../_shared/mod.ts";
import { ACTIVITY_KINDS } from "../domain/value-objects.ts";
import type { Activity, Company, Contact, Deal } from "../domain/entities.ts";
import type { PipelineStageSummary } from "../domain/ports.ts";

export const CreateCompanySchema = V.schema({
  name: V.text(1, 160),
  domain: V.string().lower().max(120).optional(),
  industry: V.string().max(80).optional(),
  size: V.string().max(40).optional(),
  website: V.string().max(240).optional(),
  phone: V.string().max(40).optional(),
  address: V.record().optional(),
  ownerId: V.uuid().optional(),
});

export const UpdateCompanySchema = V.schema({
  id: V.uuid(),
  name: V.text(1, 160).optional(),
  domain: V.string().lower().max(120).optional(),
  industry: V.string().max(80).optional(),
  size: V.string().max(40).optional(),
  website: V.string().max(240).optional(),
  phone: V.string().max(40).optional(),
  address: V.record().optional(),
  ownerId: V.uuid().optional(),
});

export const CreateContactSchema = V.schema({
  firstName: V.text(1, 80),
  lastName: V.string().max(80).default(""),
  email: V.email().optional(),
  phone: V.string().max(40).optional(),
  jobTitle: V.string().max(80).optional(),
  companyId: V.uuid().optional(),
  ownerId: V.uuid().optional(),
});

export const UpdateContactSchema = V.schema({
  id: V.uuid(),
  firstName: V.text(1, 80).optional(),
  lastName: V.string().max(80).optional(),
  email: V.email().optional(),
  phone: V.string().max(40).optional(),
  jobTitle: V.string().max(80).optional(),
  companyId: V.uuid().optional(),
  ownerId: V.uuid().optional(),
});

export const CreateDealSchema = V.schema({
  title: V.text(2, 160),
  stageKey: V.string().lower().max(32).optional(),
  companyId: V.uuid().optional(),
  contactId: V.uuid().optional(),
  amountCents: V.cents().default(0),
  currency: V.string().upper().matching(/^[A-Z]{3}$/, "ISO 4217").default("BRL"),
  expectedCloseDate: V.date().optional(),
  ownerId: V.uuid().optional(),
});

export const UpdateDealSchema = V.schema({
  id: V.uuid(),
  title: V.text(2, 160).optional(),
  companyId: V.uuid().optional(),
  contactId: V.uuid().optional(),
  amountCents: V.cents().optional(),
  currency: V.string().upper().matching(/^[A-Z]{3}$/, "ISO 4217").optional(),
  expectedCloseDate: V.date().optional(),
  ownerId: V.uuid().optional(),
});

export const MoveDealSchema = V.schema({ id: V.uuid(), stageKey: V.string().lower().max(32) });
export const WinDealSchema = V.schema({ id: V.uuid() });
export const LoseDealSchema = V.schema({ id: V.uuid(), reason: V.text(3, 240) });
export const IdSchema = V.schema({ id: V.uuid() });

export const LogActivitySchema = V.schema({
  id: V.uuid(),
  kind: V.enumOf(ACTIVITY_KINDS),
  subject: V.text(2, 160),
  notes: V.string().max(4000).default(""),
  occurredAt: V.date().optional(),
});

export class CompanyPresenter {
  static toDto(company: Company): Record<string, unknown> {
    return {
      id: company.id,
      tenantId: company.tenantId,
      name: company.name,
      domain: company.domain,
      industry: company.industry,
      size: company.size,
      website: company.website,
      phone: company.phone,
      address: company.address,
      ownerId: company.ownerId,
      createdAt: company.createdAt.toISOString(),
      updatedAt: company.updatedAt.toISOString(),
    };
  }
}

export class ContactPresenter {
  static toDto(contact: Contact): Record<string, unknown> {
    return {
      id: contact.id,
      tenantId: contact.tenantId,
      companyId: contact.companyId,
      firstName: contact.firstName,
      lastName: contact.lastName,
      fullName: contact.fullName,
      email: contact.email,
      phone: contact.phone,
      jobTitle: contact.jobTitle,
      ownerId: contact.ownerId,
      createdAt: contact.createdAt.toISOString(),
      updatedAt: contact.updatedAt.toISOString(),
    };
  }
}

export class ActivityPresenter {
  static toDto(activity: Activity): Record<string, unknown> {
    return {
      id: activity.id,
      dealId: activity.dealId,
      kind: activity.kind,
      subject: activity.subject,
      notes: activity.notes,
      occurredAt: activity.occurredAt.toISOString(),
      createdBy: activity.createdBy,
      createdAt: activity.createdAt.toISOString(),
    };
  }
}

export class DealPresenter {
  static toDto(deal: Deal, includeActivities = false): Record<string, unknown> {
    const dto: Record<string, unknown> = {
      id: deal.id,
      tenantId: deal.tenantId,
      title: deal.title,
      companyId: deal.companyId,
      contactId: deal.contactId,
      stageKey: deal.stageKey,
      status: deal.status.value,
      amountCents: deal.amount.cents,
      currency: deal.amount.currency,
      amountFormatted: deal.amount.format(),
      probability: deal.probability,
      weightedCents: deal.weightedAmount.cents,
      expectedCloseDate: deal.expectedCloseDate?.toISOString().slice(0, 10) ?? null,
      closedAt: deal.closedAt?.toISOString() ?? null,
      lostReason: deal.lostReason,
      ownerId: deal.ownerId,
      createdAt: deal.createdAt.toISOString(),
      updatedAt: deal.updatedAt.toISOString(),
    };
    if (includeActivities) {
      dto.activities = deal.activities.map((activity) => ActivityPresenter.toDto(activity));
    }
    return dto;
  }
}

export class PipelinePresenter {
  static toDto(stages: readonly PipelineStageSummary[]): Record<string, unknown> {
    const totalCents = stages.reduce((sum, stage) => sum + stage.totalCents, 0);
    const weightedCents = stages.reduce((sum, stage) => sum + stage.weightedCents, 0);
    return {
      stages: stages.map((stage) => ({ ...stage })),
      totals: {
        deals: stages.reduce((sum, stage) => sum + stage.dealsCount, 0),
        totalCents,
        weightedCents,
      },
    };
  }
}
