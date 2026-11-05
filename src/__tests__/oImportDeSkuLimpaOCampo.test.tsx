/**
 * Depois de importar, o campo de ficheiro fica vazio, e o `await` não o impede.
 *
 * O React põe `e.currentTarget` a null assim que o handler cede. O onChange fazia
 * `await handleImport(file)` e só depois `e.currentTarget.value = ""`, e Root Diagnostics
 * recebeu "Cannot set properties of null (setting 'value')" duas vezes a 04/11/2026.
 * A importação já tinha terminado, mas o campo ficava com o ficheiro, e escolher o
 * mesmo ficheiro outra vez não voltava a disparar o onChange.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SKUProductsPage from "@/pages/dashboard/SKUProductsPage";

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const empty = { data: [], error: null };
  const chain: Record<string, unknown> = {
    then: (resolve: (r: typeof empty) => unknown) => resolve(empty),
  };
  for (const m of ["select", "order", "range", "limit", "eq"]) chain[m] = () => chain;
  return { supabase: { from: () => chain, rpc: () => Promise.resolve(empty) } };
});

afterEach(() => vi.restoreAllMocks());

describe("Import XLSX na página de SKUs", () => {
  it("limpa o campo depois de o handler ceder", async () => {
    // Recusar a confirmação chega: o handler cede na mesma antes de limpar o campo.
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <SKUProductsPage />
      </QueryClientProvider>,
    );
    const input = container.querySelector<HTMLInputElement>("#sku-import-input")!;
    const cleared = vi.fn();
    Object.defineProperty(input, "value", { configurable: true, get: () => "", set: cleared });

    fireEvent.change(input, {
      target: { files: [new File(["sku,name\nA,B"], "skus.csv", { type: "text/csv" })] },
    });

    await waitFor(() => expect(cleared).toHaveBeenCalledWith(""));
  });
});
