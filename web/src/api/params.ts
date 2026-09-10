/** Parametros que toda rota paginada aceita. `sort` e o nome da coluna, em snake_case. */
export interface ListParams {
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: "asc" | "desc";
}
