import('dotenv').then(async d => {
  d.config({ path: '.env', override: true });

  // Test the nemotron client directly
  const { nemotronClient } = await import('../../server/nemotron/client.ts');
  const { NEMOTRON_CONFIG } = await import('../../server/nemotron/config.ts');

  const model = NEMOTRON_CONFIG.specialists.lightning; // Bolt-equivalent that works
  console.log('Model:', model.modelId);
  console.log('Key env:', model.apiKeyEnv);

  try {
    const result = await nemotronClient.chat({
      model,
      messages: [{ role: 'user', content: 'Reply with OK' }],
      temperature: 0.5,
      maxOutputTokens: 50,
      json: false,
    });
    console.log('SUCCESS:', result.text.slice(0, 100));
    console.log('Tokens:', result.tokens);
  } catch (e: any) {
    console.error('ERROR:', e.message);
    console.error('Status:', e.status);
  }
}).catch(e => console.error('Import error:', e.message));
