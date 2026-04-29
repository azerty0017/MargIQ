const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Endpoint de diagnostic ──────────────────────────
app.get('/api/health', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.json({ status: 'ERROR', message: 'GEMINI_API_KEY manquante dans les variables' });
  }

  // Test rapide vers Gemini
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const testRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Réponds juste: OK' }] }],
        generationConfig: { maxOutputTokens: 10 }
      })
    });
    const data = await testRes.json();
    if (data.error) {
      return res.json({ status: 'ERROR', message: data.error.message, code: data.error.code });
    }
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    res.json({ status: 'OK', gemini_reply: reply, key_prefix: apiKey.substring(0, 8) + '...' });
  } catch (err) {
    res.json({ status: 'ERROR', message: err.message });
  }
});

// ── Endpoint principal d'analyse ────────────────────
app.post('/api/analyze', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: true,
      message: 'GEMINI_API_KEY non configurée sur le serveur'
    });
  }

  try {
    const { system, messages } = req.body;
    const userMsg = messages[0];
    const parts = [];

    if (system) parts.push({ text: system });

    if (Array.isArray(userMsg.content)) {
      userMsg.content.forEach(block => {
        if (block.type === 'text') {
          parts.push({ text: block.text });
        } else if (block.type === 'image') {
          parts.push({ inline_data: { mime_type: block.source.media_type, data: block.source.data } });
        } else if (block.type === 'document') {
          parts.push({ inline_data: { mime_type: 'application/pdf', data: block.source.data } });
        }
      });
    } else {
      parts.push({ text: userMsg.content });
    }

    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json'
      }
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    console.log('→ Appel Gemini en cours...');
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const geminiData = await response.json();
    console.log('← Réponse Gemini reçue. Status:', response.status);

    // Si Gemini retourne une erreur
    if (geminiData.error) {
      console.error('Erreur Gemini:', geminiData.error);
      return res.status(500).json({
        error: true,
        message: geminiData.error.message,
        code: geminiData.error.code
      });
    }

    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!text) {
      console.error('Réponse Gemini vide:', JSON.stringify(geminiData));
      return res.status(500).json({
        error: true,
        message: 'Gemini a retourné une réponse vide',
        raw: geminiData
      });
    }

    console.log('✓ Analyse réussie, longueur réponse:', text.length);
    res.json({ content: [{ type: 'text', text }] });

  } catch (err) {
    console.error('Erreur serveur:', err);
    res.status(500).json({ error: true, message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MargIQ en ligne → port ${PORT}`));
