import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  DateRange,
  Email,
  Money,
  Quantity,
  Slug,
} from "../../supabase/functions/_shared/domain/value-objects.ts";
import { ValidationError } from "../../supabase/functions/_shared/domain/errors.ts";

Deno.test("Money soma e subtrai em centavos inteiros", () => {
  const total = Money.fromCents(1050).add(Money.fromCents(2575));
  assertEquals(total.cents, 3625);
  assertEquals(total.units, 36.25);
  assertEquals(total.subtract(Money.fromCents(625)).cents, 3000);
});

Deno.test("Money recusa operacao entre moedas diferentes", () => {
  assertThrows(
    () => Money.fromCents(100, "BRL").add(Money.fromCents(100, "USD")),
    ValidationError,
    "moedas diferentes",
  );
});

Deno.test("Money arredonda o rateio para o centavo", () => {
  assertEquals(Money.fromCents(29900).prorate(0.5).cents, 14950);
  assertEquals(Money.fromCents(29900).prorate(1 / 3).cents, 9967);
  assertEquals(Money.fromCents(10000).percentage(60).cents, 6000);
});

Deno.test("Money recusa fracao fora de 0 a 1 no rateio", () => {
  assertThrows(() => Money.fromCents(100).prorate(1.5), ValidationError);
});

Deno.test("Email normaliza e valida", () => {
  assertEquals(Email.create("  Alice@Acme.TEST ").value, "alice@acme.test");
  assertEquals(Email.create("alice@acme.test").domain, "acme.test");
  assertThrows(() => Email.create("sem-arroba"), ValidationError);
});

Deno.test("Slug deriva de um nome livre", () => {
  assertEquals(Slug.fromName("Acme Industrias LTDA").value, "acme-industrias-ltda");
  assertEquals(Slug.fromName("Construcao & Cia").value, "construcao-cia");
  assertThrows(() => Slug.create("Acme Ltda"), ValidationError);
});

Deno.test("Quantity exige inteiro positivo", () => {
  assertEquals(Quantity.create(3).plus(Quantity.create(2)).value, 5);
  assertThrows(() => Quantity.create(0), ValidationError);
  assertThrows(() => Quantity.create(1.5), ValidationError);
});

Deno.test("DateRange calcula a fracao restante do periodo", () => {
  const start = new Date("2026-01-01T00:00:00Z");
  const end = new Date("2026-01-31T00:00:00Z");
  const range = DateRange.create(start, end);

  assertEquals(range.remainingRatio(start), 1);
  assertEquals(range.remainingRatio(end), 0);
  assertEquals(range.remainingRatio(new Date("2026-01-16T00:00:00Z")), 0.5);
  assertEquals(range.contains(new Date("2026-01-15T00:00:00Z")), true);
  assertEquals(range.contains(end), false);
});

Deno.test("DateRange recusa fim anterior ao inicio", () => {
  assertThrows(
    () => DateRange.create(new Date("2026-02-01"), new Date("2026-01-01")),
    ValidationError,
  );
});
