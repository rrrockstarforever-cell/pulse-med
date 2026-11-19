import('dotenv').then(async d => {
  d.config({ path: '.env', override: true });
  const { nemotronOrchestrator } = await import('../../server/nemotron/orchestrator.ts');

  const req = 'Build a GTA-like open-world game with a 36 km² map. Design everything inside the map: roads, districts, landmarks, interiors, NPCs, vehicles, economy, missions, weather, lighting, physics, traffic AI. Give a full design document covering world layout, gameplay systems, and technical architecture.';

  try {
    const result = await nemotronOrchestrator.orchestrate({
      requestId: 'gta-test-1',
      userRequest: req,
      conversationHistory: [],
    });
    console.log('STATUS:', result.status);
    console.log('Category:', result.category);
    console.log('Complexity:', result.complexity);
    console.log('DurationMs:', result.durationMs);
    console.log('Models used (distinct):', [...new Set(result.taskResults.map(r => r.modelId))]);
    console.log('Task count:', result.taskResults.length);
    for (const r of result.taskResults) {
      console.log(`  - ${r.taskId} | ${r.modelRole} (${r.modelId}) | ${r.status} | ${r.durationMs}ms${r.error ? ' | ERR: ' + r.error : ''}`);
    }
    console.log('QC:', result.qualityControl.finalAssessment);
    console.log('FINAL ANSWER (first 500 chars):', result.finalAnswer?.slice(0, 500));
  } catch (e: any) {
    console.error('Orchestration error:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
}).catch(e => console.error('Import error:', e.message));
