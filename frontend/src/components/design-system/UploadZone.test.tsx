import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_SECURITY_NOTE, MAX_FILE_BYTES, UploadZone, formatFileSize, validateFile } from "./UploadZone";

function makeFile(name: string, type: string, size = 1024) {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("validateFile", () => {
  it("accepts PDF, JPG and PNG", () => {
    expect(validateFile(makeFile("a.pdf", "application/pdf"))).toBeNull();
    expect(validateFile(makeFile("a.jpg", "image/jpeg"))).toBeNull();
    expect(validateFile(makeFile("a.png", "image/png"))).toBeNull();
    expect(validateFile(makeFile("a.txt", "text/plain"))).toBeNull();
  });

  it("accepts a known extension when the browser reports no MIME type", () => {
    expect(validateFile(makeFile("contrato.PDF", ""))).toBeNull();
  });

  it("rejects other formats", () => {
    expect(validateFile(makeFile("virus.exe", "application/x-msdownload"))).toBe(
      "Formato não aceito. Envie PDF, JPG, PNG ou TXT.",
    );
  });

  it("rejects files above 2,5 MB", () => {
    expect(validateFile(makeFile("grande.pdf", "application/pdf", MAX_FILE_BYTES + 1))).toBe(
      "Arquivo acima de 2,5 MB.",
    );
  });
});

describe("formatFileSize", () => {
  it.each([
    [500, "1 KB"],
    [842_000, "822 KB"],
    [2_621_440, "2,5 MB"],
  ])("formats %d bytes as %s", (bytes, label) => {
    expect(formatFileSize(bytes)).toBe(label);
  });
});

describe("UploadZone", () => {
  it("does not promise sending while dragging", () => {
    render(<UploadZone />);
    fireEvent.dragEnter(screen.getByTestId("upload-dropzone"));
    expect(screen.getByText("Solte para anexar")).toBeInTheDocument();
    expect(screen.queryByText(/enviar/i)).not.toBeInTheDocument();
  });

  it("shows the truthful security note by default", () => {
    render(<UploadZone />);
    expect(DEFAULT_SECURITY_NOTE).toBe(
      "Os arquivos são criptografados e só você consegue baixá-los. Juízes e advogados não os veem.",
    );
    expect(screen.getByText(DEFAULT_SECURITY_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(/ponta a ponta/i)).not.toBeInTheDocument();
  });

  it("lists a valid file and reports it", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const onFilesChange = vi.fn();
    render(<UploadZone onFilesChange={onFilesChange} />);
    const file = makeFile("contrato.pdf", "application/pdf");

    await user.upload(screen.getByLabelText("Selecionar arquivos"), file);

    expect(screen.getByText("contrato.pdf")).toBeInTheDocument();
    expect(screen.getByText("Pronto para enviar")).toBeInTheDocument();
    expect(onFilesChange).toHaveBeenLastCalledWith([file]);
  });

  it("lists an invalid file with its error and does not report it", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const onFilesChange = vi.fn();
    render(<UploadZone onFilesChange={onFilesChange} />);

    await user.upload(screen.getByLabelText("Selecionar arquivos"), makeFile("virus.exe", "application/x-msdownload"));

    expect(screen.getByText("Formato não aceito. Envie PDF, JPG, PNG ou TXT.")).toBeInTheDocument();
    expect(onFilesChange).toHaveBeenLastCalledWith([]);
  });

  it("removes a file", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const onFilesChange = vi.fn();
    render(<UploadZone onFilesChange={onFilesChange} />);
    await user.upload(screen.getByLabelText("Selecionar arquivos"), makeFile("contrato.pdf", "application/pdf"));

    await user.click(screen.getByRole("button", { name: "Remover contrato.pdf" }));

    expect(screen.queryByText("contrato.pdf")).not.toBeInTheDocument();
    expect(onFilesChange).toHaveBeenLastCalledWith([]);
  });

  it("accepts dropped files", () => {
    const onFilesChange = vi.fn();
    render(<UploadZone onFilesChange={onFilesChange} />);
    const file = makeFile("prova.png", "image/png");

    fireEvent.drop(screen.getByTestId("upload-dropzone"), { dataTransfer: { files: [file] } });

    expect(screen.getByText("prova.png")).toBeInTheDocument();
    expect(onFilesChange).toHaveBeenLastCalledWith([file]);
  });

  it("rejects files beyond the limit of 5", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const onFilesChange = vi.fn();
    render(<UploadZone onFilesChange={onFilesChange} />);
    const files = Array.from({ length: 6 }, (_, i) => makeFile(`f${i}.pdf`, "application/pdf"));
    await user.upload(screen.getByLabelText("Selecionar arquivos"), files);
    expect(screen.getByText("Limite de 5 arquivos.")).toBeInTheDocument();
    expect(onFilesChange).toHaveBeenLastCalledWith(files.slice(0, 5));
  });

  it("renders a custom security note", () => {
    render(<UploadZone securityNote="Nota personalizada." />);
    expect(screen.getByText("Nota personalizada.")).toBeInTheDocument();
  });

  it("keeps both files when two are uploaded at once", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const onFilesChange = vi.fn();
    render(<UploadZone onFilesChange={onFilesChange} />);
    const a = makeFile("a.pdf", "application/pdf");
    const b = makeFile("b.pdf", "application/pdf");

    await user.upload(screen.getByLabelText("Selecionar arquivos"), [a, b]);

    expect(screen.getByText("a.pdf")).toBeInTheDocument();
    expect(screen.getByText("b.pdf")).toBeInTheDocument();
    expect(onFilesChange).toHaveBeenLastCalledWith(expect.arrayContaining([a, b]));
  });

  it("announces ready files in an always-mounted live region", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<UploadZone />);
    expect(screen.getByRole("status")).toHaveTextContent("");
    await user.upload(screen.getByLabelText("Selecionar arquivos"), makeFile("a.pdf", "application/pdf"));
    expect(screen.getByRole("status")).toHaveTextContent("1 arquivo anexado");
  });

  describe("controlled", () => {
    function Harness({ onChange }: { onChange?: (files: File[]) => void }) {
      const [files, setFiles] = useState<File[]>([]);
      return (
        <>
          <UploadZone
            files={files}
            onFilesChange={(next) => {
              setFiles(next);
              onChange?.(next);
            }}
          />
          <button type="button" onClick={() => setFiles([])}>
            Limpar
          </button>
        </>
      );
    }

    it("calls onFilesChange with the full next list and renders from props", async () => {
      const user = userEvent.setup({ applyAccept: false });
      const onChange = vi.fn();
      render(<Harness onChange={onChange} />);
      const a = makeFile("a.pdf", "application/pdf");
      const b = makeFile("b.pdf", "application/pdf");

      await user.upload(screen.getByLabelText("Selecionar arquivos"), a);
      await user.upload(screen.getByLabelText("Selecionar arquivos"), b);

      expect(onChange).toHaveBeenLastCalledWith([a, b]);
      expect(screen.getByText("a.pdf")).toBeInTheDocument();
      expect(screen.getByText("b.pdf")).toBeInTheDocument();
    });

    it("clears the list when the parent resets files", async () => {
      const user = userEvent.setup({ applyAccept: false });
      render(<Harness />);
      await user.upload(screen.getByLabelText("Selecionar arquivos"), makeFile("a.pdf", "application/pdf"));
      expect(screen.getByText("a.pdf")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Limpar" }));

      expect(screen.queryByText("a.pdf")).not.toBeInTheDocument();
    });

    it("removes an accepted file through the parent", async () => {
      const user = userEvent.setup({ applyAccept: false });
      const onChange = vi.fn();
      render(<Harness onChange={onChange} />);
      await user.upload(screen.getByLabelText("Selecionar arquivos"), makeFile("a.pdf", "application/pdf"));
      await user.click(screen.getByRole("button", { name: "Remover a.pdf" }));
      expect(onChange).toHaveBeenLastCalledWith([]);
      expect(screen.queryByText("a.pdf")).not.toBeInTheDocument();
    });

    it("keeps rejected files visible until removed", async () => {
      const user = userEvent.setup({ applyAccept: false });
      render(<Harness />);
      await user.upload(screen.getByLabelText("Selecionar arquivos"), makeFile("x.exe", "application/x-msdownload"));
      expect(screen.getByText("Formato não aceito. Envie PDF, JPG, PNG ou TXT.")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Remover x.exe" }));
      expect(screen.queryByText("x.exe")).not.toBeInTheDocument();
    });
  });

  describe("disabled", () => {
    it("ignores uploads", async () => {
      const user = userEvent.setup({ applyAccept: false });
      const onFilesChange = vi.fn();
      render(<UploadZone disabled onFilesChange={onFilesChange} />);
      const input = screen.getByLabelText("Selecionar arquivos");
      expect(input).toBeDisabled();
      await user.upload(input, makeFile("a.pdf", "application/pdf"));
      expect(screen.queryByText("a.pdf")).not.toBeInTheDocument();
      expect(onFilesChange).not.toHaveBeenCalled();
    });

    it("ignores drops", () => {
      const onFilesChange = vi.fn();
      render(<UploadZone disabled onFilesChange={onFilesChange} />);
      fireEvent.drop(screen.getByTestId("upload-dropzone"), {
        dataTransfer: { files: [makeFile("a.png", "image/png")] },
      });
      expect(screen.queryByText("a.png")).not.toBeInTheDocument();
      expect(onFilesChange).not.toHaveBeenCalled();
    });

    it("disables remove buttons and dims the zone", () => {
      const file = makeFile("a.pdf", "application/pdf");
      render(<UploadZone disabled files={[file]} />);
      expect(screen.getByRole("button", { name: "Remover a.pdf" })).toBeDisabled();
      expect(screen.getByTestId("upload-dropzone")).toHaveClass("opacity-60", "cursor-not-allowed");
    });
  });
});
