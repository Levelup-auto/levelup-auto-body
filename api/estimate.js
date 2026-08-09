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
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: match[1],
          data: match[2],
        }
      };
    }).filter(Boolean);

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          ...imageBlocks,
          {
            type: 'text',
            text: `You are an expert auto body repair estimator for Level Up Auto Body in Canoga Park, CA. Analyze the damage shown in these photos of a ${vehicle || 'vehicle'}.

Generate a detailed line-item repair estimate in JSON format. Be realistic with pricing based on Southern California auto body repair rates.

Return ONLY valid JSON in this exact format:
{
  "summary": "2-3 sentence description of the visible damage in plain English",
  "items": [
    {
      "description": "Name of the repair (e.g. 'Front Bumper Cover - Replace & Paint')",
      "category": "Category (Parts / Labor / Paint & Materials / Electrical / Structural)",
      "cost": "$X,XXX"
    }
  ],
  "total": "$X,XXX - $X,XXX"
}

Rules:
- Break down into specific line items (parts cost, labor cost, paint/materials separately)
- Use realistic Southern California body shop rates ($65-85/hr labor)
- OEM parts pricing
- Include items like: parts replacement, body labor, paint labor, paint materials, blend panels, clear coat, any mechanical work visible
- If damage is minor (scratches/dents), estimate lower accordingly
- Give the total as a range (low to high)
- Be thorough but realistic — typically 6-15 line items for a real estimate
- If you cannot clearly see damage, note that in the summary and give a conservative estimate`
          }
        ]
      }]
    });

    const textBlock = message.content.find(b => b.type === 'text');
    const text = textBlock ? textBlock.text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse estimate from AI response');
    }
    const estimate = JSON.parse(jsonMatch[0]);

    try {
      await fetch('https://formsubmit.co/ajax/repairs@levelupab.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          _subject: `New AI Estimate Request — ${name}`,
          Name: name,
          Phone: phone,
          Vehicle: vehicle,
          Insurance: insurance || 'Not specified',
          'Claim Number': claim || 'Not provided',
          'AI Estimate Total': estimate.total,
          'Damage Summary': estimate.summary,
          'Line Items': estimate.items.map(i => `${i.description}: ${i.cost}`).join('\n'),
          _template: 'table'
        })
      });
    } catch (emailErr) {
      console.error('Email notification failed:', emailErr);
    }

    res.status(200).json(estimate);

  } catch (error) {
    console.error('Estimate error:', error);
    res.status(500).json({ error: 'Failed to generate estimate. Please try again.' });
  }
};
