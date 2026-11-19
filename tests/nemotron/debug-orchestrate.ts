import('dotenv').then(async d => {
  d.config({ path: '.env', override: true });
  const { nemotronOrchestrator } = await import('../../server/nemotron/orchestrator.ts');

  try {
    const result = await nemotronOrchestrator.orchestrate({
      requestId: 'debug-1',
      userRequest: 'Reply with OK',
      conversationHistory: [],
    });
    console.log('STATUS:', result.status);
    console.log('Category:', result.category);
    console.log('Models:', result.taskResults.map(r => r.modelRole + ':' + r.status));
    console.log('Errors:', result.taskResults.map(r => r.error).filter(Boolean));
    console.log('Final answer:', result.finalAnswer?.slice(0, 300));
  } catch (e: any) {
    console.error('Orchestration error:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
}).catch(e => console.error('Import error:', e.message));
