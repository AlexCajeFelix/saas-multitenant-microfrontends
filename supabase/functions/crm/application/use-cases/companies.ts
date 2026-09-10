import {
  BaseUseCase,
  type AuditTrail,
  type Clock,
  type EventPublisher,
  type IdGenerator,
  type Page,
  type PageRequest,
  type RequestContext,
} from "../../../_shared/mod.ts";
import { Company, Contact } from "../../domain/entities.ts";
import type {
  CompanyFilter,
  CompanyRepository,
  ContactFilter,
  ContactRepository,
} from "../../domain/ports.ts";
import { CompanyPresenter, ContactPresenter } from "../dto.ts";

export interface CreateCompanyInput {
  name: string;
  domain?: string;
  industry?: string;
  size?: string;
  website?: string;
  phone?: string;
  address?: Record<string, unknown>;
  ownerId?: string;
}

export class CreateCompanyUseCase extends BaseUseCase<CreateCompanyInput, Record<string, unknown>> {
  constructor(
    private readonly companies: CompanyRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "crm.company.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(
    input: CreateCompanyInput,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    const company = Company.create({
      id: this.ids.generate(),
      tenantId: ctx.requireTenantId(),
      createdBy: ctx.requireUserId(),
      now: this.clock.now(),
      ...input,
    });
    const saved = await this.companies.insert(company);
    await this.events.publish(company.pullEvents());
    await this.audit.record({
      action: "company.created",
      resourceType: "company",
      resourceId: saved.id,
      metadata: { name: saved.name },
    });
    return CompanyPresenter.toDto(saved);
  }
}

export class ListCompaniesUseCase
  extends BaseUseCase<{ filter: CompanyFilter; page: PageRequest }, Record<string, unknown>> {
  constructor(private readonly companies: CompanyRepository) {
    super();
  }

  protected override get permission(): string | null {
    return "crm.company.read";
  }

  protected override async handle(
    input: { filter: CompanyFilter; page: PageRequest },
  ): Promise<Record<string, unknown>> {
    const result: Page<unknown> = (await this.companies.search(input.filter, input.page))
      .map((company) => CompanyPresenter.toDto(company));
    return result.toJSON();
  }
}

export class GetCompanyUseCase extends BaseUseCase<{ id: string }, Record<string, unknown>> {
  constructor(private readonly companies: CompanyRepository) {
    super();
  }
  protected override get permission(): string | null {
    return "crm.company.read";
  }
  protected override async handle(input: { id: string }): Promise<Record<string, unknown>> {
    return CompanyPresenter.toDto(await this.companies.getById(input.id));
  }
}

export interface UpdateCompanyInput extends Partial<CreateCompanyInput> {
  id: string;
}

export class UpdateCompanyUseCase extends BaseUseCase<UpdateCompanyInput, Record<string, unknown>> {
  constructor(
    private readonly companies: CompanyRepository,
    private readonly clock: Clock,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "crm.company.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(
    input: UpdateCompanyInput,
  ): Promise<Record<string, unknown>> {
    const { id, ...patch } = input;
    const company = await this.companies.getById(id);
    company.update(patch, this.clock.now());
    const saved = await this.companies.update(company);
    await this.audit.record({
      action: "company.updated",
      resourceType: "company",
      resourceId: id,
      metadata: { fields: Object.keys(patch) },
    });
    return CompanyPresenter.toDto(saved);
  }
}

export class DeleteCompanyUseCase extends BaseUseCase<{ id: string }, { deleted: string }> {
  constructor(
    private readonly companies: CompanyRepository,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "crm.company.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(input: { id: string }): Promise<{ deleted: string }> {
    await this.companies.deleteById(input.id);
    await this.audit.record({
      action: "company.deleted",
      resourceType: "company",
      resourceId: input.id,
    });
    return { deleted: input.id };
  }
}

export interface CreateContactInput {
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  companyId?: string;
  ownerId?: string;
}

export class CreateContactUseCase extends BaseUseCase<CreateContactInput, Record<string, unknown>> {
  constructor(
    private readonly contacts: ContactRepository,
    private readonly companies: CompanyRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "crm.contact.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(
    input: CreateContactInput,
    ctx: RequestContext,
  ): Promise<Record<string, unknown>> {
    // A empresa precisa existir e ser do mesmo tenant; getById ja garante ambos.
    if (input.companyId) await this.companies.getById(input.companyId);

    const contact = Contact.create({
      id: this.ids.generate(),
      tenantId: ctx.requireTenantId(),
      createdBy: ctx.requireUserId(),
      now: this.clock.now(),
      ...input,
    });
    const saved = await this.contacts.insert(contact);
    await this.events.publish(contact.pullEvents());
    await this.audit.record({
      action: "contact.created",
      resourceType: "contact",
      resourceId: saved.id,
      metadata: { email: saved.email },
    });
    return ContactPresenter.toDto(saved);
  }
}

export class ListContactsUseCase
  extends BaseUseCase<{ filter: ContactFilter; page: PageRequest }, Record<string, unknown>> {
  constructor(private readonly contacts: ContactRepository) {
    super();
  }
  protected override get permission(): string | null {
    return "crm.contact.read";
  }
  protected override async handle(
    input: { filter: ContactFilter; page: PageRequest },
  ): Promise<Record<string, unknown>> {
    const result: Page<unknown> = (await this.contacts.search(input.filter, input.page))
      .map((contact) => ContactPresenter.toDto(contact));
    return result.toJSON();
  }
}

export class GetContactUseCase extends BaseUseCase<{ id: string }, Record<string, unknown>> {
  constructor(private readonly contacts: ContactRepository) {
    super();
  }
  protected override get permission(): string | null {
    return "crm.contact.read";
  }
  protected override async handle(input: { id: string }): Promise<Record<string, unknown>> {
    return ContactPresenter.toDto(await this.contacts.getById(input.id));
  }
}

export interface UpdateContactInput extends Partial<CreateContactInput> {
  id: string;
}

export class UpdateContactUseCase extends BaseUseCase<UpdateContactInput, Record<string, unknown>> {
  constructor(
    private readonly contacts: ContactRepository,
    private readonly clock: Clock,
    private readonly audit: AuditTrail,
  ) {
    super();
  }

  protected override get permission(): string | null {
    return "crm.contact.write";
  }
  protected override get mutating(): boolean {
    return true;
  }

  protected override async handle(input: UpdateContactInput): Promise<Record<string, unknown>> {
    const { id, ...patch } = input;
    const contact = await this.contacts.getById(id);
    contact.update(patch, this.clock.now());
    const saved = await this.contacts.update(contact);
    await this.audit.record({
      action: "contact.updated",
      resourceType: "contact",
      resourceId: id,
      metadata: { fields: Object.keys(patch) },
    });
    return ContactPresenter.toDto(saved);
  }
}

export class DeleteContactUseCase extends BaseUseCase<{ id: string }, { deleted: string }> {
  constructor(
    private readonly contacts: ContactRepository,
    private readonly audit: AuditTrail,
  ) {
    super();
  }
  protected override get permission(): string | null {
    return "crm.contact.write";
  }
  protected override get mutating(): boolean {
    return true;
  }
  protected override async handle(input: { id: string }): Promise<{ deleted: string }> {
    await this.contacts.deleteById(input.id);
    await this.audit.record({
      action: "contact.deleted",
      resourceType: "contact",
      resourceId: input.id,
    });
    return { deleted: input.id };
  }
}
