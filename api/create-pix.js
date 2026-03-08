/**
 * api/create-pix.js
 * Serverless function — Gera cobrança PIX via Mercado Pago
 *
 * Variáveis de ambiente necessárias:
 *   MERCADOPAGO_ACCESS_TOKEN  — Token de acesso (produção ou sandbox)
 *   BASE_URL                  — URL pública do site (ex: https://meusite.com)
 *                               Usado para notification_url do Webhook (só HTTPS)
 */

module.exports = async function handler(req, res) {
    // ── CORS ──────────────────────────────────────────────────────────────────
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido.' });
    }

    // ── Config ────────────────────────────────────────────────────────────────
    const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
    const BASE_URL = process.env.BASE_URL || '';

    if (!MERCADOPAGO_ACCESS_TOKEN) {
        console.error('[PIX] MERCADOPAGO_ACCESS_TOKEN não configurado.');
        return res.status(500).json({ error: 'Serviço de pagamento não configurado.' });
    }

    // ── Validação do payload ──────────────────────────────────────────────────
    const { nome, email, valor, cpf } = req.body || {};

    const valorNum = parseFloat(valor);
    if (!valor || isNaN(valorNum) || valorNum <= 0) {
        return res.status(400).json({ error: 'Valor de doação inválido.' });
    }
    if (valorNum > 10000) {
        return res.status(400).json({ error: 'Valor máximo por doação: R$ 10.000,00.' });
    }

    const emailFinal = (email && email.includes('@'))
        ? email.trim()
        : `doador.${Date.now()}@campanhaluan.org`;

    const nomeCompleto = (nome || 'Doador Anônimo').trim();
    const partes       = nomeCompleto.split(' ');
    const firstName    = partes[0] || 'Doador';
    const lastName     = partes.slice(1).join(' ') || 'Anônimo';
    const cleanCpf     = (cpf || '').replace(/\D/g, '');

    // ── Payload Mercado Pago ──────────────────────────────────────────────────
    const payload = {
        transaction_amount: valorNum,
        description: 'Doação – Luan tem 8 anos e quer salvar a mãe',
        payment_method_id: 'pix',
        payer: {
            email: emailFinal,
            first_name: firstName,
            last_name: lastName,
        },
    };

    if (cleanCpf.length === 11) {
        payload.payer.identification = { type: 'CPF', number: cleanCpf };
    }

    // Webhook só funciona com HTTPS
    if (BASE_URL && BASE_URL.startsWith('https://')) {
        payload.notification_url = `${BASE_URL}/api/pix-webhook`;
    }

    const idempotencyKey = `luan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // ── Chamada à API do Mercado Pago ─────────────────────────────────────────
    try {
        const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
                'X-Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify(payload),
        });

        const mpData = await mpRes.json();

        if (!mpRes.ok) {
            const msg = mpData?.message || mpData?.error || 'Erro desconhecido.';
            console.error('[MP Error]', JSON.stringify(mpData));
            return res.status(400).json({
                error: `Falha ao gerar PIX: ${msg}`,
                code: `PIX-${mpRes.status}`,
            });
        }

        const txData = mpData.point_of_interaction?.transaction_data;

        return res.status(200).json({
            success: true,
            pix: {
                paymentId:    mpData.id,
                status:       mpData.status,
                qrCode:       txData?.qr_code       || '',
                qrCodeBase64: txData?.qr_code_base64 || '',
                valor:        valorNum,
            },
        });

    } catch (err) {
        console.error('[Server Error]', err);
        return res.status(500).json({ error: 'Erro interno. Tente novamente em instantes.' });
    }
};
