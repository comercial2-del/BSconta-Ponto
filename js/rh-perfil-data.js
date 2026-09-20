/*
 * BSconta+ Perfil do colaborador — camada de dados REAL (Supabase:
 * rh.colaboradores, campos pessoais + foto no bucket avatares-rh)
 * =============================================================================
 * O formulário "Editar dados pessoais" e o botão de trocar foto eram
 * cosméticos no protótipo (não liam os campos, não gravavam nada — só
 * mostravam um toast). Isso agora grava de verdade, mas com uma restrição
 * real de segurança: o colaborador NUNCA tem UPDATE direto em
 * rh.colaboradores (só RH/RH_ADMIN têm, via "rh_staff all"), porque senão
 * ele poderia alterar o próprio cargo/departamento/status/e-mail. As duas
 * ações que a tela promete que ele pode fazer sozinho — dados pessoais e
 * foto — passam por funções do banco (security definer, ver
 * db/supabase/11_perfil_dados_pessoais.sql) que só tocam essas colunas
 * específicas, depois de validar que a linha é dele mesmo.
 */

function rhMapPerfilColaborador(row, dadosPessoais) {
  return {
    id: row.id,
    codigo: row.codigo,
    name: row.nome,
    email: row.email,
    cargo: row.cargo,
    departamento: row.departamento,
    admissao: row.admissao,
    status: row.status,
    photo: row.foto_url,
    horasSemanais: row.horas_semanais,
    gestor: row.gestor_nome,
    cpf: dadosPessoais?.cpf ?? null,
    nascimento: dadosPessoais?.data_nascimento ?? null,
    telefone: row.telefone,
    endereco: dadosPessoais?.endereco ?? null,
    cep: dadosPessoais?.cep ?? null,
  };
}

/** CPF/nascimento/endereço/CEP ficam cifrados no banco (ver
 * db/supabase/19_criptografia_dados_pessoais.sql) — nunca vêm de um SELECT
 * direto na tabela. São decifrados só aqui, na hora de montar o perfil para
 * exibir na tela, através da função rh.colaboradores_dados_pessoais, que só
 * decifra a linha do próprio colaborador (ou qualquer uma, se quem chamar
 * for RH/RH_ADMIN). */
async function rhCarregarPerfilColaborador(colaboradorId) {
  const [{ data, error }, { data: dadosPessoaisRows, error: dpErr }] = await Promise.all([
    sb.from("colaboradores").select("*").eq("id", colaboradorId).single(),
    sb.rpc("colaboradores_dados_pessoais", { p_colaborador_id: colaboradorId }),
  ]);
  if (error) throw error;
  if (dpErr) throw dpErr;
  const dadosPessoais = (dadosPessoaisRows || [])[0] || null;
  return rhMapPerfilColaborador(data, dadosPessoais);
}

async function rhSalvarDadosPessoaisColaborador({ cpf, nascimento, telefone, endereco, cep }) {
  const { error } = await sb.rpc("colaborador_atualizar_dados_pessoais", {
    p_cpf: cpf || null,
    p_data_nascimento: nascimento || null,
    p_telefone: telefone || null,
    p_endereco: endereco || null,
    p_cep: cep || null,
  });
  if (error) throw error;
  return true;
}

/** Sobe a nova foto pro bucket público avatares-rh (na própria pasta do
 * colaborador) e liga a URL pública em rh.colaboradores.foto_url via RPC.
 * Devolve a nova URL, já com um parâmetro pra estourar cache de imagem. */
async function rhAtualizarFotoPerfilColaborador(colaboradorId, file) {
  if (!file) throw new Error("Selecione uma imagem.");
  if (!file.type.startsWith("image/")) throw new Error("Selecione um arquivo de imagem (JPG, PNG, etc.).");
  if (file.size > 5 * 1024 * 1024) throw new Error("A imagem excede o limite de 5 MB.");
  const ext = (file.name.match(/\.[a-zA-Z0-9]+$/) || [".jpg"])[0];
  const caminho = `${colaboradorId}/avatar-${Date.now()}${ext}`;
  const { error: upErr } = await sb.storage.from("avatares-rh").upload(caminho, file, { contentType: file.type });
  if (upErr) throw upErr;
  const { data: pub } = sb.storage.from("avatares-rh").getPublicUrl(caminho);
  const url = pub.publicUrl;
  const { error: rpcErr } = await sb.rpc("colaborador_atualizar_foto", { p_foto_url: url });
  if (rpcErr) throw rpcErr;
  return url;
}
