import { Link } from "react-router-dom";
import { EmptyState } from "../components/ui/States";
import { Button } from "../components/ui/Button";

export function NotFound() {
  return (
    <EmptyState
      title="Essa tela nao existe"
      message="O endereco nao bate com nenhuma rota da aplicacao."
      action={
        <Link to="/">
          <Button variant="primary">Voltar a visao geral</Button>
        </Link>
      }
    />
  );
}
