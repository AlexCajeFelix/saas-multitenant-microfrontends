import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { crmApi } from "@saas/platform/api/crm";
import type { Deal } from "@saas/platform/api/types";
import { useTenant } from "@saas/platform/lib/tenant";
import { useApiMutation, fieldError, optional } from "@saas/platform/lib/mutations";
import { centsToInput, parseMoneyToCents } from "@saas/platform/lib/format";
import { Field, Input, MoneyInput, Select } from "@saas/platform/components/ui/Field";
import { FormDialog } from "@saas/platform/components/ui/Dialog";

/** Criacao e edicao de negocio. O estagio so se escolhe na criacao; depois ele
 *  muda pela rota propria, que registra o evento de mudanca de estagio. */
export function DealFormDialog({
  open,
  onClose,
  deal,
}: {
  open: boolean;
  onClose: () => void;
  deal?: Deal;
}) {
  const { tenantId } = useTenant();
  const editing = Boolean(deal);

  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [stageKey, setStageKey] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [contactId, setContactId] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(deal?.title ?? "");
    setAmount(deal ? centsToInput(deal.amountCents) : "");
    setStageKey(deal?.stageKey ?? "");
    setCompanyId(deal?.companyId ?? "");
    setContactId(deal?.contactId ?? "");
    setExpectedCloseDate(deal?.expectedCloseDate ?? "");
  }, [open, deal]);

  const pipeline = useQuery({
    queryKey: ["pipeline", tenantId],
    queryFn: crmApi.pipeline,
    enabled: open && !editing,
  });

  const companies = useQuery({
    queryKey: ["companies", tenantId, "options"],
    queryFn: () => crmApi.listCompanies({ pageSize: 100, sort: "name", order: "asc" }),
    enabled: open,
  });

  const contacts = useQuery({
    queryKey: ["contacts", tenantId, "options"],
    queryFn: () => crmApi.listContacts({ pageSize: 100, sort: "first_name", order: "asc" }),
    enabled: open,
  });

  const save = useApiMutation({
    mutationFn: () => {
      const payload = {
        title: title.trim(),
        amountCents: parseMoneyToCents(amount),
        companyId: optional(companyId),
        contactId: optional(contactId),
        expectedCloseDate: optional(expectedCloseDate),
      };
      return deal
        ? crmApi.updateDeal(deal.id, payload)
        : crmApi.createDeal({ ...payload, stageKey: optional(stageKey) });
    },
    invalidate: [
      ["deals", tenantId],
      ["pipeline", tenantId],
      ["deal", tenantId, deal?.id],
    ],
    success: editing ? "Negocio atualizado" : "Negocio criado",
    onDone: onClose,
  });

  return (
    <FormDialog
      open={open}
      title={editing ? "Editar negocio" : "Novo negocio"}
      onClose={onClose}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        save.mutate();
      }}
      submitLabel={editing ? "Salvar" : "Criar"}
      submitting={save.isPending}
    >
      <Field label="Titulo" error={fieldError(save.error, "title")}>
        <Input
          required
          autoFocus
          minLength={2}
          maxLength={160}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Implantacao do sistema"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Valor (R$)" error={fieldError(save.error, "amountCents")}>
          <MoneyInput value={amount} onChange={(event) => setAmount(event.target.value)} />
        </Field>
        {editing ? (
          <Field label="Previsao de fechamento" error={fieldError(save.error, "expectedCloseDate")}>
            <Input
              type="date"
              value={expectedCloseDate}
              onChange={(event) => setExpectedCloseDate(event.target.value)}
            />
          </Field>
        ) : (
          <Field label="Estagio" hint="Sem escolher, entra no primeiro do funil.">
            <Select value={stageKey} onChange={(event) => setStageKey(event.target.value)}>
              <option value="">padrao</option>
              {(pipeline.data?.stages ?? [])
                .filter((stage) => stage.stageKey !== "won" && stage.stageKey !== "lost")
                .map((stage) => (
                  <option key={stage.stageKey} value={stage.stageKey}>
                    {stage.stageName}
                  </option>
                ))}
            </Select>
          </Field>
        )}
      </div>

      {!editing && (
        <Field label="Previsao de fechamento" error={fieldError(save.error, "expectedCloseDate")}>
          <Input
            type="date"
            value={expectedCloseDate}
            onChange={(event) => setExpectedCloseDate(event.target.value)}
          />
        </Field>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Empresa" error={fieldError(save.error, "companyId")}>
          <Select value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
            <option value="">nenhuma</option>
            {(companies.data?.items ?? []).map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Contato" error={fieldError(save.error, "contactId")}>
          <Select value={contactId} onChange={(event) => setContactId(event.target.value)}>
            <option value="">nenhum</option>
            {(contacts.data?.items ?? []).map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.fullName}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </FormDialog>
  );
}
