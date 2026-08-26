// Busca código-fonte real de contratos Clarity via API pública da Hiro
// (sem conta, sem autenticação, dados de blockchain pública).

export async function fetchContractSource(deployer, contractName) {
  const url = `https://api.hiro.so/v2/contracts/source/${deployer}/${contractName}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} buscando ${deployer}.${contractName}`);
  const json = await res.json();
  if (!json.source) throw new Error(`Sem source para ${deployer}.${contractName}: ${JSON.stringify(json).slice(0, 200)}`);
  return json.source;
}
