// Bar do Guto — aplicativo da loja para Windows (sem janela preta).
//  - executa runtime\node.exe app\scripts\loja.mjs --gui ESCONDIDO (o Node vai embutido no pacote, como o
//    navegador vai embutido em outros aplicativos; o usuário não instala nem vê nada dele);
//  - primeira abertura: tela para criar a senha do admin (passada ao sistema por variável de ambiente);
//  - tela "Abrindo…" enquanto o banco e o sistema sobem; depois abre o sistema em JANELA PRÓPRIA
//    (Microsoft Edge em modo aplicativo, sem barra de endereço; se não houver Edge/Chrome, o navegador padrão);
//    --kiosk-printing: imprime direto na impressora padrão, sem diálogo (nota e pedidos da cozinha);
//  - fica como ícone perto do relógio: abrir, endereço para celulares, cópias de segurança, registro, encerrar;
//  - uma única cópia aberta; abrir de novo só traz a janela; "--encerrar" fecha com segurança (instalador/testes);
//  - registro do funcionamento em <dados>\registros (para suporte), sem senhas;
//  - impressora da cozinha: imprime a fila <dados>\impressao\fila na impressora escolhida (duas impressoras:
//    a nota sai na padrão do Windows pelo navegador; a via da cozinha sai aqui, na impressora pelo nome).
// Compilado com o csc do .NET Framework (C# 5): csc /target:winexe /win32icon:BarDoGuto.ico BarDoGuto.cs
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Printing;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class Programa
{
    public const string NomeMutex = "BarDoGuto.Loja";
    public const string EventoAbrir = "BarDoGuto.Loja.Abrir";
    public const string EventoEncerrar = "BarDoGuto.Loja.Encerrar";

    [STAThread]
    static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Opcoes op = new Opcoes(args);

        if (op.Encerrar) return PedirEncerramento();

        bool primeiro;
        using (Mutex mutex = new Mutex(true, NomeMutex, out primeiro))
        {
            if (!primeiro)
            {
                Sinalizar(EventoAbrir); // já está aberto: só traz a janela
                return 0;
            }
            AppLoja app = new AppLoja(op);
            if (app.Iniciar()) Application.Run(app);
            return app.Codigo;
        }
    }

    static void Sinalizar(string nome)
    {
        try { using (EventWaitHandle e = EventWaitHandle.OpenExisting(nome)) e.Set(); } catch { }
    }

    /// Pede o encerramento da cópia aberta e espera ela terminar (até 90 s).
    static int PedirEncerramento()
    {
        Sinalizar(EventoEncerrar);
        for (int i = 0; i < 180; i++)
        {
            try { using (Mutex.OpenExisting(NomeMutex)) { } }
            catch (WaitHandleCannotBeOpenedException) { return 0; }
            catch { return 0; }
            Thread.Sleep(500);
        }
        return 1;
    }
}

class Opcoes
{
    public string Dados;
    public bool SemNavegador, NaoInterativo, SemPausa, Encerrar, Exemplo;
    public List<string> Repassar = new List<string>();

    public Opcoes(string[] args)
    {
        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i];
            if (a == "--encerrar") { Encerrar = true; continue; }
            if (a == "--sem-pausa") { SemPausa = true; continue; } // execução automatizada: sem caixas de diálogo
            if (a == "--sem-navegador") SemNavegador = true;
            if (a == "--nao-interativo") NaoInterativo = true;
            if (a == "--exemplo") Exemplo = true;
            if (a == "--dados" && i + 1 < args.Length) Dados = args[i + 1];
            Repassar.Add(a);
        }
    }
}

class AppLoja : ApplicationContext
{
    readonly Opcoes op;
    readonly string pastaPrograma, pastaDados, pastaJanela;
    public int Codigo;
    Control ui;
    NotifyIcon bandeja;
    TelaAbrindo telaAbrindo;
    Process node;
    StreamWriter registro;
    string caminhoRegistro;
    readonly object travaRegistro = new object();
    readonly Queue<string> ultimas = new Queue<string>();
    string urlLocal, pastaCopias, erro;
    string[] urlsRede = new string[0];
    bool saindo, encerrado;
    EventWaitHandle evAbrir, evEncerrar;

    public AppLoja(Opcoes op)
    {
        this.op = op;
        pastaPrograma = AppDomain.CurrentDomain.BaseDirectory;
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        pastaDados = op.Dados != null ? Path.GetFullPath(op.Dados) : Path.Combine(local, "BarDoGuto", "loja");
        pastaJanela = Path.Combine(local, "BarDoGuto", "janela");
        pastaCopias = Path.Combine(pastaDados, "copias-de-seguranca");
    }

    public bool Iniciar()
    {
        ui = new Control();
        IntPtr h = ui.Handle; // cria a janela invisível usada para voltar à thread da interface
        AbrirRegistro();
        Registrar("Bar do Guto iniciando (" + LerVersao() + ")");

        string nodeExe = Path.Combine(pastaPrograma, "runtime", "node.exe");
        string script = Path.Combine(pastaPrograma, "app", "scripts", "loja.mjs");
        if (!File.Exists(nodeExe) || !File.Exists(script))
        {
            Falhar("Arquivos do sistema não encontrados em " + pastaPrograma + ".\n\nReinstale o Bar do Guto.");
            return false;
        }

        // primeira abertura neste computador: criar a senha do admin
        string senha = null;
        bool exemplo = op.Exemplo;
        if (!File.Exists(Path.Combine(pastaDados, "banco", "PG_VERSION")) && !op.NaoInterativo)
        {
            using (TelaPrimeiraAbertura t = new TelaPrimeiraAbertura())
            {
                if (t.ShowDialog() != DialogResult.OK) { Registrar("Primeira abertura cancelada."); Codigo = 0; return false; }
                senha = t.Senha;
                exemplo = t.Exemplo;
            }
        }

        CriarBandeja();
        telaAbrindo = new TelaAbrindo();
        telaAbrindo.Show();

        StringBuilder argumentos = new StringBuilder();
        argumentos.Append(Aspas(script)).Append(" --gui --sem-navegador");
        if (exemplo && !op.Exemplo) argumentos.Append(" --exemplo");
        foreach (string a in op.Repassar) argumentos.Append(' ').Append(Aspas(a));

        ProcessStartInfo psi = new ProcessStartInfo(nodeExe, argumentos.ToString());
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true; // nada de janela preta
        psi.WorkingDirectory = Path.Combine(pastaPrograma, "app");
        psi.RedirectStandardInput = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.StandardOutputEncoding = Encoding.UTF8;
        psi.StandardErrorEncoding = Encoding.UTF8;
        if (senha != null) psi.EnvironmentVariables["GUTO_SENHA_ADMIN"] = senha;
        try
        {
            node = new Process();
            node.StartInfo = psi;
            node.EnableRaisingEvents = true;
            node.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { Linha(e.Data); };
            node.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { Linha(e.Data); };
            node.Exited += delegate { NaThreadDaInterface(NodeTerminou); };
            node.Start();
            node.BeginOutputReadLine();
            node.BeginErrorReadLine();
        }
        catch (Exception e)
        {
            Falhar("Não foi possível iniciar o sistema: " + e.Message);
            return false;
        }

        evAbrir = new EventWaitHandle(false, EventResetMode.AutoReset, Programa.EventoAbrir);
        evEncerrar = new EventWaitHandle(false, EventResetMode.AutoReset, Programa.EventoEncerrar);
        Thread espera = new Thread(EsperarPedidos);
        espera.IsBackground = true;
        espera.Start();
        SystemEvents.SessionEnding += delegate { Registrar("Windows encerrando a sessão."); EncerrarSistema(); };
        new ImpressoraCozinha(Path.Combine(pastaDados, "impressao"), Registrar).Iniciar();
        return true;
    }

    // ---------- comunicação com o sistema ----------

    void Linha(string s)
    {
        if (s == null) return;
        s = Regex.Replace(s, "\x1b\\[[0-9;]*m", "");
        if (s.StartsWith("GUTO_PRONTO ") || s.StartsWith("GUTO_ERRO "))
        {
            int i = s.IndexOf(' ');
            string tipo = s.Substring(0, i);
            string texto;
            try { texto = Encoding.UTF8.GetString(Convert.FromBase64String(s.Substring(i + 1).Trim())); }
            catch { texto = s.Substring(i + 1); }
            if (tipo == "GUTO_ERRO") { erro = texto; Registrar("ERRO: " + texto); }
            else NaThreadDaInterface(delegate { Pronto(texto); });
            return;
        }
        Registrar(s);
        if (s.StartsWith("[loja] ") && telaAbrindo != null)
        {
            string etapa = s.Substring(7);
            NaThreadDaInterface(delegate { if (telaAbrindo != null) telaAbrindo.Etapa(etapa); });
        }
    }

    void Pronto(string dados)
    {
        string[] p = dados.Split('|');
        urlLocal = p[0];
        urlsRede = p.Length > 1 && p[1].Length > 0 ? p[1].Split(',') : new string[0];
        if (p.Length > 3) pastaCopias = p[3];
        Registrar("Pronto em " + urlLocal);
        FecharTelaAbrindo();
        AtualizarMenu();
        bandeja.Text = "Bar do Guto — funcionando";
        if (!op.SemNavegador) AbrirJanela();
        if (!op.SemPausa)
            bandeja.ShowBalloonTip(8000, "Bar do Guto está funcionando",
                "Ele fica aqui, perto do relógio. Fechar a janela não desliga o sistema. Para encerrar no fim do dia: clique com o botão direito neste ícone → Encerrar.",
                ToolTipIcon.Info);
    }

    void NodeTerminou()
    {
        if (saindo) return;
        int codigo = -1;
        try { codigo = node.ExitCode; } catch { }
        Registrar("O sistema terminou (código " + codigo + ").");
        string msg = erro ?? (urlLocal == null ? "O sistema não conseguiu abrir." : "O sistema parou inesperadamente.");
        Codigo = codigo == 0 ? 0 : 1;
        saindo = true;
        FecharTelaAbrindo();
        bandeja.Visible = false;
        if (codigo != 0) Falhar(msg + "\n\nAbra o Bar do Guto de novo. Se continuar, envie o registro ao suporte:\n" + caminhoRegistro);
        ExitThread();
    }

    void EsperarPedidos()
    {
        WaitHandle[] ev = new WaitHandle[] { evAbrir, evEncerrar };
        for (;;)
        {
            int i = WaitHandle.WaitAny(ev);
            if (i == 0) { if (!op.SemNavegador) NaThreadDaInterface(AbrirJanela); }
            else { NaThreadDaInterface(delegate { Sair(false); }); return; }
        }
    }

    /// Encerra o sistema com segurança: pede "sair", espera até 40 s e só então força.
    void EncerrarSistema()
    {
        lock (this)
        {
            if (encerrado) return;
            encerrado = true;
        }
        saindo = true;
        try
        {
            if (node != null && !node.HasExited)
            {
                Registrar("Encerrando o sistema com segurança…");
                try { node.StandardInput.WriteLine("sair"); node.StandardInput.Close(); } catch { }
                if (!node.WaitForExit(40000))
                {
                    Registrar("O sistema não terminou a tempo; forçando.");
                    Executar("taskkill", "/T /F /PID " + node.Id, true);
                }
            }
        }
        catch (Exception e) { Registrar("Falha ao encerrar: " + e.Message); }
        Registrar("Encerrado.");
    }

    void Sair(bool perguntar)
    {
        if (saindo) return;
        if (perguntar)
        {
            DialogResult r = MessageBox.Show(
                "Encerrar o Bar do Guto?\n\nCaixa, celulares dos atendentes e cozinha deixam de funcionar até você abrir de novo. Os dados ficam guardados.",
                "Bar do Guto", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
            if (r != DialogResult.Yes) return;
        }
        saindo = true;
        bandeja.Text = "Bar do Guto — encerrando…";
        if (telaAbrindo == null) { telaAbrindo = new TelaAbrindo(); telaAbrindo.Show(); }
        telaAbrindo.Etapa("Encerrando com segurança… (os dados ficam guardados)");
        Thread t = new Thread(delegate()
        {
            EncerrarSistema();
            NaThreadDaInterface(delegate { FecharTelaAbrindo(); bandeja.Visible = false; ExitThread(); });
        });
        t.IsBackground = true;
        t.Start();
    }

    // ---------- janela do sistema ----------

    void AbrirJanela()
    {
        if (saindo) return;
        if (urlLocal == null)
        {
            if (telaAbrindo != null) telaAbrindo.Activate();
            return;
        }
        string nav = AcharNavegador();
        try
        {
            if (nav != null)
            {
                Directory.CreateDirectory(pastaJanela);
                Process.Start(nav, "--app=" + urlLocal + " --user-data-dir=" + Aspas(pastaJanela) +
                    " --no-first-run --no-default-browser-check --start-maximized --kiosk-printing");
            }
            else Process.Start(urlLocal);
        }
        catch (Exception e)
        {
            Registrar("Não abriu a janela: " + e.Message);
            MessageBox.Show("Não foi possível abrir a janela do sistema.\n\nAbra o navegador e digite: " + urlLocal, "Bar do Guto", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    static string AcharNavegador()
    {
        string[] nomes = { "msedge.exe", "chrome.exe" };
        string[] subpastas = { @"Microsoft\Edge\Application\msedge.exe", @"Google\Chrome\Application\chrome.exe" };
        foreach (string sub in subpastas)
        {
            foreach (string raiz in new string[] {
                Environment.GetEnvironmentVariable("ProgramFiles(x86)"),
                Environment.GetEnvironmentVariable("ProgramFiles"),
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) })
            {
                if (string.IsNullOrEmpty(raiz)) continue;
                string c = Path.Combine(raiz, sub);
                if (File.Exists(c)) return c;
            }
        }
        foreach (string n in nomes)
        {
            foreach (RegistryKey baseKey in new RegistryKey[] { Registry.CurrentUser, Registry.LocalMachine })
            {
                try
                {
                    using (RegistryKey k = baseKey.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + n))
                    {
                        if (k == null) continue;
                        string c = k.GetValue("") as string;
                        if (!string.IsNullOrEmpty(c) && File.Exists(c)) return c;
                    }
                }
                catch { }
            }
        }
        return null;
    }

    // ---------- ícone perto do relógio ----------

    void CriarBandeja()
    {
        bandeja = new NotifyIcon();
        try { bandeja.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { bandeja.Icon = SystemIcons.Application; }
        bandeja.Text = "Bar do Guto — abrindo…";
        bandeja.Visible = true;
        bandeja.DoubleClick += delegate { AbrirJanela(); };
        AtualizarMenu();
    }

    void AtualizarMenu()
    {
        ContextMenuStrip m = new ContextMenuStrip();
        ToolStripMenuItem abrir = new ToolStripMenuItem("Abrir o Bar do Guto", null, delegate { AbrirJanela(); });
        abrir.Font = new Font(abrir.Font, FontStyle.Bold);
        abrir.Enabled = urlLocal != null;
        m.Items.Add(abrir);
        if (urlsRede.Length > 0)
        {
            m.Items.Add(new ToolStripSeparator());
            ToolStripMenuItem titulo = new ToolStripMenuItem("Celulares e tablets (Wi-Fi da loja) — clique para copiar:");
            titulo.Enabled = false;
            m.Items.Add(titulo);
            foreach (string u in urlsRede)
            {
                string url = u;
                m.Items.Add(new ToolStripMenuItem("    " + url, null, delegate
                {
                    try { Clipboard.SetText(url); } catch { }
                    bandeja.ShowBalloonTip(4000, "Endereço copiado", url + "\nAbra esse endereço no navegador do celular conectado ao Wi-Fi da loja.", ToolTipIcon.Info);
                }));
            }
        }
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add(new ToolStripMenuItem("Pasta das cópias de segurança", null, delegate { AbrirPasta(pastaCopias); }));
        m.Items.Add(new ToolStripMenuItem("Registro de funcionamento (para suporte)", null, delegate
        {
            try { Process.Start("notepad.exe", Aspas(caminhoRegistro)); } catch { }
        }));
        m.Items.Add(new ToolStripMenuItem("Sobre — versão " + LerVersao(), null, delegate
        {
            MessageBox.Show("Bar do Guto " + LerVersao() + "\n\nDados da loja: " + pastaDados + "\nCópias de segurança: " + pastaCopias + "\nPrograma: " + pastaPrograma,
                "Sobre o Bar do Guto", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }));
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add(new ToolStripMenuItem("Encerrar o Bar do Guto", null, delegate { Sair(true); }));
        ContextMenuStrip antigo = bandeja.ContextMenuStrip;
        bandeja.ContextMenuStrip = m;
        if (antigo != null) antigo.Dispose();
    }

    static void AbrirPasta(string p)
    {
        try { Directory.CreateDirectory(p); Process.Start("explorer.exe", Aspas(p)); } catch { }
    }

    // ---------- utilidades ----------

    void NaThreadDaInterface(MethodInvoker f)
    {
        try { if (ui != null && ui.IsHandleCreated) ui.BeginInvoke(f); } catch { }
    }

    void FecharTelaAbrindo()
    {
        if (telaAbrindo == null) return;
        telaAbrindo.Close();
        telaAbrindo.Dispose();
        telaAbrindo = null;
    }

    void Falhar(string msg)
    {
        Registrar("FALHA: " + msg.Replace("\n", " "));
        Codigo = 1;
        if (op.SemPausa) return;
        MessageBox.Show(msg, "Bar do Guto", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    void AbrirRegistro()
    {
        try
        {
            string pasta = Path.Combine(pastaDados, "registros");
            Directory.CreateDirectory(pasta);
            caminhoRegistro = Path.Combine(pasta, DateTime.Now.ToString("yyyy-MM-dd") + ".txt");
            registro = new StreamWriter(new FileStream(caminhoRegistro, FileMode.Append, FileAccess.Write, FileShare.ReadWrite), new UTF8Encoding(false));
            registro.AutoFlush = true;
            string[] antigos = Directory.GetFiles(pasta, "*.txt");
            Array.Sort(antigos);
            for (int i = 0; i < antigos.Length - 30; i++) { try { File.Delete(antigos[i]); } catch { } }
        }
        catch { registro = null; }
    }

    void Registrar(string s)
    {
        lock (travaRegistro)
        {
            string l = DateTime.Now.ToString("HH:mm:ss") + "  " + s;
            ultimas.Enqueue(l);
            while (ultimas.Count > 40) ultimas.Dequeue();
            try { if (registro != null) registro.WriteLine(l); } catch { }
        }
    }

    string LerVersao()
    {
        try
        {
            string v = File.ReadAllText(Path.Combine(pastaPrograma, "versao.txt")).Trim();
            Match m = Regex.Match(v, @"Bar do Guto (\S+)");
            return m.Success ? m.Groups[1].Value : v;
        }
        catch { return "?"; }
    }

    static string Aspas(string s)
    {
        return "\"" + s.Replace("\"", "\\\"") + "\"";
    }

    static void Executar(string exe, string argumentos, bool esperar)
    {
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo(exe, argumentos);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            using (Process p = Process.Start(psi)) { if (esperar) p.WaitForExit(15000); }
        }
        catch { }
    }

    protected override void ExitThreadCore()
    {
        EncerrarSistema();
        if (bandeja != null) { bandeja.Visible = false; bandeja.Dispose(); }
        try { if (registro != null) registro.Dispose(); } catch { }
        base.ExitThreadCore();
    }
}

static class Cores
{
    public static readonly Color Grafite = Color.FromArgb(24, 24, 27);
    public static readonly Color GrafiteClaro = Color.FromArgb(161, 161, 170);
    public static readonly Color Laranja = Color.FromArgb(234, 88, 12);
}

/// Tela pequena enquanto o sistema abre (ou encerra).
class TelaAbrindo : Form
{
    readonly Label etapa;

    public TelaAbrindo()
    {
        Text = "Bar do Guto";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(440, 180);
        BackColor = Cores.Grafite;
        ShowInTaskbar = true;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        Panel faixa = new Panel();
        faixa.BackColor = Cores.Laranja;
        faixa.Dock = DockStyle.Top;
        faixa.Height = 6;
        Controls.Add(faixa);

        Label titulo = new Label();
        titulo.Text = "Bar do Guto";
        titulo.ForeColor = Color.White;
        titulo.Font = new Font("Segoe UI", 20f, FontStyle.Bold);
        titulo.AutoSize = true;
        titulo.Location = new Point(28, 28);
        Controls.Add(titulo);

        etapa = new Label();
        etapa.Text = "Abrindo o sistema da loja…";
        etapa.ForeColor = Cores.GrafiteClaro;
        etapa.Font = new Font("Segoe UI", 10f);
        etapa.AutoSize = false;
        etapa.Size = new Size(384, 40);
        etapa.Location = new Point(30, 82);
        Controls.Add(etapa);

        ProgressBar barra = new ProgressBar();
        barra.Style = ProgressBarStyle.Marquee;
        barra.MarqueeAnimationSpeed = 30;
        barra.Size = new Size(384, 8);
        barra.Location = new Point(30, 140);
        Controls.Add(barra);
    }

    public void Etapa(string texto)
    {
        etapa.Text = texto.Length > 140 ? texto.Substring(0, 140) + "…" : texto;
    }
}

/// Primeira abertura neste computador: cria a senha do administrador.
class TelaPrimeiraAbertura : Form
{
    readonly TextBox senha1, senha2;
    readonly CheckBox exemplo;
    readonly Label aviso;
    public string Senha;
    public bool Exemplo;

    public TelaPrimeiraAbertura()
    {
        Text = "Bar do Guto — primeira abertura";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(480, 400);
        BackColor = Color.White;
        Font = new Font("Segoe UI", 10f);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        Panel topo = new Panel();
        topo.BackColor = Cores.Grafite;
        topo.Dock = DockStyle.Top;
        topo.Height = 84;
        Controls.Add(topo);
        Label t = new Label();
        t.Text = "Bem-vindo ao Bar do Guto";
        t.ForeColor = Color.White;
        t.Font = new Font("Segoe UI", 15f, FontStyle.Bold);
        t.AutoSize = true;
        t.Location = new Point(24, 16);
        topo.Controls.Add(t);
        Label st = new Label();
        st.Text = "Primeira abertura neste computador";
        st.ForeColor = Cores.GrafiteClaro;
        st.AutoSize = true;
        st.Location = new Point(26, 50);
        topo.Controls.Add(st);

        Label explica = new Label();
        explica.Text = "Crie a senha do usuário \"admin\" (dono/gerente). Guarde-a: sem ela não é possível entrar no sistema.";
        explica.AutoSize = false;
        explica.Size = new Size(432, 44);
        explica.Location = new Point(24, 100);
        Controls.Add(explica);

        Controls.Add(Rotulo("Senha (mínimo 8 caracteres)", 150));
        senha1 = Campo(172);
        Controls.Add(Rotulo("Digite a senha de novo", 212));
        senha2 = Campo(234);

        exemplo = new CheckBox();
        exemplo.Text = "Carregar cardápio de exemplo (preços demonstrativos — revise todos)";
        exemplo.AutoSize = false;
        exemplo.Size = new Size(432, 40);
        exemplo.Location = new Point(24, 274);
        Controls.Add(exemplo);

        aviso = new Label();
        aviso.ForeColor = Color.FromArgb(185, 28, 28);
        aviso.AutoSize = false;
        aviso.Size = new Size(432, 22);
        aviso.Location = new Point(24, 316);
        Controls.Add(aviso);

        Button ok = new Button();
        ok.Text = "Criar e abrir";
        ok.Size = new Size(140, 38);
        ok.Location = new Point(316, 346);
        ok.BackColor = Cores.Laranja;
        ok.ForeColor = Color.White;
        ok.FlatStyle = FlatStyle.Flat;
        ok.FlatAppearance.BorderSize = 0;
        ok.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
        ok.Click += delegate { Confirmar(); };
        Controls.Add(ok);

        Button cancelar = new Button();
        cancelar.Text = "Cancelar";
        cancelar.Size = new Size(110, 38);
        cancelar.Location = new Point(196, 346);
        cancelar.DialogResult = DialogResult.Cancel;
        Controls.Add(cancelar);

        AcceptButton = ok;
        CancelButton = cancelar;
    }

    Label Rotulo(string texto, int y)
    {
        Label l = new Label();
        l.Text = texto;
        l.AutoSize = true;
        l.Location = new Point(24, y);
        l.ForeColor = Color.FromArgb(63, 63, 70);
        return l;
    }

    TextBox Campo(int y)
    {
        TextBox c = new TextBox();
        c.UseSystemPasswordChar = true;
        c.Size = new Size(432, 28);
        c.Location = new Point(24, y);
        Controls.Add(c);
        return c;
    }

    void Confirmar()
    {
        if (senha1.Text.Length < 8) { aviso.Text = "A senha precisa ter pelo menos 8 caracteres."; senha1.Focus(); return; }
        if (senha1.Text != senha2.Text) { aviso.Text = "As senhas não conferem. Digite de novo."; senha2.SelectAll(); senha2.Focus(); return; }
        Senha = senha1.Text;
        Exemplo = exemplo.Checked;
        DialogResult = DialogResult.OK;
        Close();
    }
}

/// Imprime as vias da cozinha deixadas pelo servidor em <dados>\impressao\fila na impressora indicada em cada
/// arquivo (pelo nome do Windows). Informa as impressoras instaladas (impressoras.txt) e o resultado (estado.txt).
class ImpressoraCozinha
{
    readonly string pasta;
    readonly Action<string> log;
    readonly Dictionary<string, int> falhas = new Dictionary<string, int>();

    public ImpressoraCozinha(string pasta, Action<string> log)
    {
        this.pasta = pasta;
        this.log = log;
    }

    public void Iniciar()
    {
        Thread t = new Thread(Laco);
        t.IsBackground = true;
        t.Start();
    }

    void Laco()
    {
        DateTime ultimaLista = DateTime.MinValue;
        for (;;)
        {
            try
            {
                if ((DateTime.Now - ultimaLista).TotalSeconds >= 60)
                {
                    GravarImpressoras();
                    ultimaLista = DateTime.Now;
                }
                string fila = Path.Combine(pasta, "fila");
                if (Directory.Exists(fila))
                {
                    string[] arqs = Directory.GetFiles(fila, "*.txt");
                    Array.Sort(arqs, StringComparer.Ordinal);
                    foreach (string a in arqs) Processar(a);
                }
            }
            catch (Exception e) { log("Impressão da cozinha: " + e.Message); }
            Thread.Sleep(1000);
        }
    }

    void GravarImpressoras()
    {
        StringBuilder sb = new StringBuilder();
        try
        {
            string padrao = new PrinterSettings().PrinterName;
            if (!string.IsNullOrEmpty(padrao)) sb.Append("PADRAO\t").Append(padrao).Append("\r\n");
        }
        catch { }
        foreach (string p in PrinterSettings.InstalledPrinters) sb.Append("IMPRESSORA\t").Append(p).Append("\r\n");
        Directory.CreateDirectory(pasta);
        string f = Path.Combine(pasta, "impressoras.txt");
        File.WriteAllText(f + ".tmp", sb.ToString(), new UTF8Encoding(false));
        if (File.Exists(f)) File.Delete(f);
        File.Move(f + ".tmp", f);
    }

    void Estado(bool ok, string msg)
    {
        try
        {
            string limpo = (msg ?? "").Replace("\t", " ").Replace("\r", " ").Replace("\n", " ");
            File.WriteAllText(Path.Combine(pasta, "estado.txt"), (ok ? "OK" : "ERRO") + "\t" + DateTime.UtcNow.ToString("o") + "\t" + limpo, new UTF8Encoding(false));
        }
        catch { }
    }

    void Processar(string arq)
    {
        string[] linhas;
        try { linhas = File.ReadAllLines(arq, Encoding.UTF8); }
        catch { return; } // ainda sendo gravado: tenta no próximo ciclo
        string impressora = "";
        int largura = 80;
        List<string[]> corpo = new List<string[]>();
        foreach (string l in linhas)
        {
            string[] p = l.Split(new char[] { '\t' }, 2);
            if (p.Length < 2) continue;
            string k = p[0].Trim('\uFEFF', ' ');
            if (k == "IMPRESSORA") impressora = p[1];
            else if (k == "LARGURA") int.TryParse(p[1], out largura);
            else corpo.Add(new string[] { k, p[1] });
        }
        string desc = Descricao(corpo);
        try
        {
            Imprimir(impressora, largura, corpo, Path.GetFileNameWithoutExtension(arq));
            File.Delete(arq);
            falhas.Remove(arq);
            Estado(true, desc);
            log("Cozinha: " + desc + " impresso em " + impressora);
        }
        catch (Exception e)
        {
            int n;
            falhas.TryGetValue(arq, out n);
            n++;
            falhas[arq] = n;
            Estado(false, "Impressora \"" + impressora + "\": " + e.Message);
            log("Cozinha: falha ao imprimir " + desc + " em " + impressora + " (tentativa " + n + "): " + e.Message);
            if (n >= 3)
            {
                // não trava a fila: guarda para conferência
                string erros = Path.Combine(pasta, "erros");
                Directory.CreateDirectory(erros);
                try { File.Move(arq, Path.Combine(erros, Path.GetFileName(arq))); } catch { }
                falhas.Remove(arq);
            }
            else Thread.Sleep(2000);
        }
    }

    static string Descricao(List<string[]> corpo)
    {
        foreach (string[] l in corpo) if (l[0] == "B") return "pedido " + l[1];
        return "teste";
    }

    void Imprimir(string impressora, int largura, List<string[]> corpo, string nome)
    {
        using (PrintDocument doc = new PrintDocument())
        {
            doc.PrintController = new StandardPrintController(); // sem janela "Imprimindo..."
            doc.DocumentName = "Bar do Guto - cozinha";
            if (!string.IsNullOrEmpty(impressora)) doc.PrinterSettings.PrinterName = impressora;
            if (!doc.PrinterSettings.IsValid) throw new Exception("impressora não encontrada");
            // impressoras de arquivo (testes): grava sem perguntar o nome do arquivo
            if (impressora.StartsWith("Microsoft Print to PDF") || impressora.StartsWith("Microsoft XPS"))
            {
                string d = Path.Combine(pasta, "arquivos");
                Directory.CreateDirectory(d);
                doc.PrinterSettings.PrintToFile = true;
                doc.PrinterSettings.PrintFileName = Path.Combine(d, nome + (impressora.Contains("PDF") ? ".pdf" : ".xps"));
            }
            doc.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
            int i = 0;
            bool estreita = largura == 58;
            Font fTitulo = new Font("Arial", estreita ? 9f : 11f, FontStyle.Bold);
            Font fGrande = new Font("Arial", estreita ? 24f : 30f, FontStyle.Bold);
            Font fLocal = new Font("Arial", estreita ? 13f : 16f, FontStyle.Bold);
            Font fCentro = new Font("Arial", estreita ? 8f : 9f, FontStyle.Regular);
            Font fItem = new Font("Arial", estreita ? 10f : 12f, FontStyle.Bold);
            Font fMod = new Font("Arial", estreita ? 9f : 10f, FontStyle.Regular);
            try
            {
                doc.PrintPage += delegate(object s, PrintPageEventArgs e)
                {
                    Graphics g = e.Graphics;
                    // largura útil da bobina (1/100 pol): 80 mm ≈ 72 mm imprimíveis; 58 mm ≈ 48 mm
                    float util = (estreita ? 48f : 72f) / 25.4f * 100f;
                    float w = Math.Min(util, e.PageBounds.Width) - 4f;
                    float x = 2f, y = 2f, limite = e.PageBounds.Height - 6f;
                    StringFormat centro = new StringFormat();
                    centro.Alignment = StringAlignment.Center;
                    StringFormat esq = new StringFormat();
                    Pen tracejado = new Pen(Color.Black, 1f);
                    tracejado.DashStyle = System.Drawing.Drawing2D.DashStyle.Dash;
                    while (i < corpo.Count)
                    {
                        string k = corpo[i][0], t = corpo[i][1];
                        Font f = k == "T" ? fTitulo : k == "B" ? fGrande : k == "P" ? fLocal : k == "C" ? fCentro : k == "I" ? fItem : fMod;
                        float recuo = k == "M" ? 10f : 0f;
                        StringFormat fmt = (k == "T" || k == "B" || k == "P" || k == "C") ? centro : esq;
                        float h = k == "R" ? 8f : g.MeasureString(t, f, (int)(w - recuo), fmt).Height + (k == "T" ? 6f : k == "I" ? 3f : 1f);
                        if (y + h > limite && y > 20f)
                        {
                            e.HasMorePages = true;
                            return;
                        }
                        if (k == "R") g.DrawLine(tracejado, x, y + 4f, x + w, y + 4f);
                        else
                        {
                            RectangleF r = new RectangleF(x + recuo, y + (k == "T" ? 3f : 0f), w - recuo, h);
                            g.DrawString(t, f, Brushes.Black, r, fmt);
                            if (k == "T") g.DrawRectangle(Pens.Black, x, y, w, h);
                        }
                        y += h;
                        i++;
                    }
                    e.HasMorePages = false;
                };
                doc.Print();
            }
            finally
            {
                fTitulo.Dispose(); fGrande.Dispose(); fLocal.Dispose(); fCentro.Dispose(); fItem.Dispose(); fMod.Dispose();
            }
        }
    }
}
