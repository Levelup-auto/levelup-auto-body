const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { name, phone, vehicle, insurance, claim, photos } = req.body;
    if (!photos || photos.length === 0) {
      return res.status(400).json({ error: 'No photos provided' });
    }
    const imageBlocks = photos.map(dataUrl => {
      const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
      if (!match) return null;
      return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
    }).filter(Boolean);
    const message = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: `You are an expert auto body repair estimator for Level Up Auto Body in Canoga Park, CA. Analyze the damage shown in these photos of a ${vehicle || 'vehicle'}. Generate a repair estimate in JSON format. Return ONLY valid JSON in this exact format: { "summary": "2-3 sentence description of the visible damage in plain English", "items": [{"description": "Description of the line item", "category": "Category", "cost": "$X,XXX"}], "total": "$X,XXX - $X,XXX" } ESTIMATE RULES: 1. PARTS: Do NOT price each part individually. List what parts need replacement or repair as descriptions, but for cost just put "Included in parts total" for each part line. Then add ONE line item called "Parts Total (Estimated)" with a rough total range for ALL parts combined. 2. LABOR - Use these EXACT rates from Level Up Auto Body: - Body Labor: $85/hr - Paint Labor: $85/hr - Mechanical Labor: $200/hr - Paint & Supply: $55/hr - Frame Labor: $135/hr 3. For labor line items, show the estimated hours and calculate the cost. For example: "Body Labor (6 hrs @ $85/hr)" with cost "$510" 4. List labor categories separately: Body Labor, Paint Labor, Mechanical Labor (if applicable), Frame Labor (if structural damage visible), Paint & Supply hours. 5. The total should be a range (low to high estimate). 6. Be thorough - identify all damaged panels, parts, and operations needed. 7. If you cannot clearly see damage, note that in the summary and give a conservative estimate. 8. Typical estimates have 8-15 line items covering: parts needing replacement (listed but not individually priced), parts total, body labor, paint labor, paint & supply, mechanical labor if needed, frame labor if needed, and any additional operations like ADAS recalibration or alignment.` }] }]
    });
    const textBlock = message.content.find(b => b.type === 'text');
    const text = textBlock ? textBlock.text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) { throw new Error('Could not parse estimate from AI response'); }
    const estimate = JSON.parse(jsonMatch[0]);
    try {
      await fetch('https://formsubmit.co/ajax/repairs@levelupab.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ _subject: `New AI Estimate Request - ${name}`, Name: name, Phone: phone, Vehicle: vehicle, Insurance: insurance || 'Not specified', 'Claim Number': claim || 'Not provided', 'AI Estimate Total': estimate.total, 'Damage Summary': estimate.summary, 'Line Items': estimate.items.map(i => `${i.description}: ${i.cost}`).join('\n'), _template: 'table' }) });
    } catch (emailErr) { console.error('Email notification failed:', emailErr); }
    res.status(200).json(estimate);
  } catch (error) {
    console.error('Estimate error:', error);
    res.status(500).json({ error: 'Failed to generate estimate. Please try again.' });
  }
};
