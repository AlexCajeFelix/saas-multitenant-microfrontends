import { EmptyState } from "./ui/States";
import { Button } from "./ui/Button";
import { AppLink } from "./AppLink";

export function NotFound() {
  return (
    <EmptyState
      title="Essa tela nao existe"
      message="O endereco nao bate com nenhuma rota da aplicacao."
      action={
        <AppLink to="/">
          <Button variant="primary">Voltar a visao geral</Button>
        </AppLink>
      }
    />
  );
}
