// Lançador do Bar do Guto (modo loja) para Windows.
// Executa runtime\node.exe app\scripts\loja.mjs na MESMA janela, repassando os argumentos.
// Se o sistema terminar com erro, a janela espera o Enter para a mensagem poder ser lida.
using System;
using System.Diagnostics;
using System.IO;

class BarDoGuto
{
    static int Main(string[] args)
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string node = Path.Combine(dir, "runtime", "node.exe");
        string script = Path.Combine(dir, "app", "scripts", "loja.mjs");
        Console.Title = "Bar do Guto - loja (nao feche esta janela)";
        if (!File.Exists(node) || !File.Exists(script))
        {
            Console.WriteLine("[ERRO] Arquivos do sistema nao encontrados em " + dir + ". Reinstale o Bar do Guto.");
            Pause();
            return 1;
        }
        string extra = "";
        bool semPausa = false;
        foreach (string a in args)
        {
            if (a == "--sem-pausa") { semPausa = true; continue; } // execução automatizada (testes)
            extra += " \"" + a.Replace("\"", "\\\"") + "\"";
        }
        var psi = new ProcessStartInfo(node, "\"" + script + "\"" + extra);
        psi.UseShellExecute = false; // mesma janela de console
        psi.WorkingDirectory = Path.Combine(dir, "app");
        try
        {
            using (Process p = Process.Start(psi))
            {
                p.WaitForExit();
                if (p.ExitCode != 0 && !semPausa) Pause();
                return p.ExitCode;
            }
        }
        catch (Exception e)
        {
            Console.WriteLine("[ERRO] Nao foi possivel iniciar: " + e.Message);
            Pause();
            return 1;
        }
    }

    static void Pause()
    {
        Console.WriteLine();
        Console.WriteLine("Pressione Enter para fechar esta janela.");
        try { Console.ReadLine(); } catch { }
    }
}
