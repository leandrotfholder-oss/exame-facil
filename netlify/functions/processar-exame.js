import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `Você é um assistente especializado em explicar resultados de exames médicos para pessoas comuns, sem conhecimento técnico.
Sua missão é traduzir linguagem médica em explicações simples, acolhedoras e compreensíveis.
Responda SEMPRE em JSON puro, sem markdown, sem blocos de código.
NUNCA faça diagnósticos. NUNCA substitua o médico. Sempre incentive a consulta médica para interpretação completa.
Se não conseguir ler algum campo com clareza, use null.
Seja conservador: nunca invente valores que não estão claramente visíveis no exame.`;

const USER_PROMPT = `Analise este resultado de exame médico e retorne um JSON com esta estrutura exata:

{
  "tipo_exame": "ex: Hemograma Completo, Glicemia, Ultrassom Abdominal, Raio-X de Tórax",
  "laboratorio": "nome do laboratório se visível",
  "paciente": "nome do paciente se visível",
  "data_coleta": "data se visível",
  "medico_solicitante": "nome do médico solicitante se visível",
  "resumo_geral": "explicação em 2-3 frases simples do que é este exame e o que avalia, para uma pessoa leiga",
  "itens": [
    {
      "nome_tecnico": "ex: Hemoglobina",
      "nome_simples": "ex: Proteína que carrega oxigênio no sangue",
      "valor": "ex: 13.5",
      "unidade": "ex: g/dL",
      "referencia": "ex: 12.0 - 16.0",
      "status": "normal|alto|baixo|critico",
      "explicacao": "explicação simples do que significa este valor para esta pessoa, em linguagem cotidiana, máximo 2 frases"
    }
  ],
  "alertas": [
    {
      "item": "nome do item com valor alterado",
      "mensagem": "explicação clara e acolhedora do que este valor alterado pode indicar, sem alarmar",
      "urgencia": "atencao|consulte_medico|urgente"
    }
  ],
  "conclusao_laudo": "se houver conclusão ou impressão diagnóstica no laudo, transcreva aqui de forma simplificada",
  "recomendacao": "orientação geral acolhedora sobre os próximos passos, sempre sugerindo consulta médica",
  "tipo_documento": "resultado_exame|solicitacao_exame|laudo_imagem|outro",
  "legibilidade": "boa|regular|ruim",
  "itens_alterados_count": 0
}

Para o campo itens_alterados_count, conte quantos itens têm status diferente de normal.
Para exames de imagem (raio-x, ultrassom, tomografia, ressonância): foque no campo conclusao_laudo e resumo_geral, pois não há valores numéricos.
Para solicitação de exame (não resultado): identifique como tipo_documento = solicitacao_exame e liste os exames solicitados no campo resumo_geral.`;

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Método não permitido" }) };
  }

  try {
    const { image, cliente_id } = JSON.parse(event.body);

    if (!image) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Imagem não enviada" }),
      };
    }

    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");

    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: base64Data },
            },
            { type: "text", text: USER_PROMPT },
          ],
        },
      ],
    });

    const rawText = response.content[0].text.trim();

    let resultado;
    try {
      resultado = JSON.parse(rawText);
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      resultado = match ? JSON.parse(match[0]) : { erro_parse: rawText };
    }

    console.log(JSON.stringify({
      cliente_id: cliente_id || "desconhecido",
      timestamp: new Date().toISOString(),
      tipo_exame: resultado.tipo_exame,
      itens_count: resultado.itens?.length || 0,
      itens_alterados: resultado.itens_alterados_count || 0,
      alertas_count: resultado.alertas?.length || 0,
      legibilidade: resultado.legibilidade,
      tokens: response.usage?.input_tokens + response.usage?.output_tokens,
    }));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ sucesso: true, resultado }),
    };
  } catch (err) {
    console.error("Erro ao processar exame:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ sucesso: false, error: "Erro ao processar exame. Tente novamente." }),
    };
  }
};
