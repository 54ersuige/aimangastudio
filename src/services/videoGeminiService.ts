import type { AISuggestions, Character, VideoModelId, InitialSceneData } from '../types';
import { generateText, generateImage } from './modelClient';
import { getServerUrl } from './modelConfig';

function createBlankCanvasAsBase64(width: number, height: number): string {
  if (typeof document === 'undefined') {
    // 1x1 transparent PNG placeholder for SSR/build environments.
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, width, height);
  }
  return canvas.toDataURL('image/png');
}

const blank16x9Canvas = createBlankCanvasAsBase64(1280, 720);

const suggestionsSchema = {
  type: 'object',
  properties: {
    transition: {
      type: 'string',
      description: "A creative video transition name (e.g., 'Whip Pan', 'Glitch Cut', 'Morph').",
    },
    vfx: {
      type: 'string',
      description: "A visual effect to apply (e.g., '8mm Film Grain', 'Chromatic Aberration', 'Slow Motion').",
    },
    camera: {
      type: 'string',
      description: "A camera movement or angle (e.g., 'Dolly Zoom In', 'Low Angle Shot', 'Crane Shot Up').",
    },
    narrative: {
      type: 'string',
      description:
        'A brief, one-sentence description of a dynamic action that connects the start and end frames, implying noticeable change over the scene\'s duration.',
    },
  },
  required: ['transition', 'vfx', 'camera', 'narrative'],
};

const webtoonStoryboardSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      sceneDescription: {
        type: 'string',
        description:
          'A detailed, cinematic prompt for an AI image generator based on one webtoon panel. It should describe the characters, setting, action, and dialogue visible in the panel.',
      },
      narrative: {
        type: 'string',
        description:
          'A brief, one-sentence description of a dynamic action that should occur during the animated scene, implying movement or change.',
      },
      duration: {
        type: 'number',
        description: 'The estimated duration of this specific scene in seconds (e.g., 3, 5, 7, 10). Must not exceed 10 seconds.',
      },
      charactersInScene: {
        type: 'array',
        items: { type: 'string' },
        description: 'A list of character names present in this scene, based on the provided character list.',
      },
      sourcePageIndex: {
        type: 'number',
        description: 'The 0-based index of the source webtoon page image this panel was extracted from.',
      },
    },
    required: ['sceneDescription', 'narrative', 'duration', 'charactersInScene', 'sourcePageIndex'],
  },
};

function normalizeReferenceImages(
  images: { data: string; mimeType: string }[],
): { data: string; mimeType: string }[] {
  return images;
}

export const recommendVideoModel = async (
  sceneDescription: string,
  narrative: string,
): Promise<{ model: VideoModelId; reasoning: string }> => {
  const prompt = `
You are an expert AI video generation consultant. Your task is to recommend the best video model for a specific scene based on the models' strengths.

Here are the available models and their specialties:
- **Seedance Pro 1.0**: Best for multi-shot narrative sequences (e.g., establishing shot -> medium shot -> close-up) with high character and style consistency.
- **Hailuo 02**: Excels at complex physics, dynamic motion, and action sequences (e.g., jumping, sports, water splashes, cloth movement).
- **Veo 3**: Uniquely capable of generating video and synchronized audio (dialogue, sound effects, music) simultaneously. Best for concept films with sound. Can output up to 4K.
- **Kling**: Strong at maintaining consistency when provided with multiple reference images. Good for cost-effective bulk generation of clips where a specific look must be maintained.
- **Agnes (free)**: Free-tier video model from Agnes AI, balanced quality for general scenes, no audio. Best default when cost matters.

**Scene to Analyze:**
- **Visuals & Setting:** "${sceneDescription}"
- **Key Action/Narrative:** "${narrative}"

Based on the scene, choose the single most suitable model from the list ['seedance', 'hailuo', 'veo', 'kling', 'agnes'] and provide a brief reasoning for your choice.
`;

  const response = await generateText(
    {
      prompt,
      jsonMode: true,
      jsonSchema: {
        type: 'object',
        properties: {
          model: {
            type: 'string',
            description: "The recommended model ID. Must be one of: 'seedance', 'hailuo', 'veo', 'kling', 'agnes'.",
          },
          reasoning: {
            type: 'string',
            description: 'A brief explanation for why this model was chosen for the given scene.',
          },
        },
        required: ['model', 'reasoning'],
      },
    },
    60000,
  );

  try {
    const result = JSON.parse(response.text.trim());
    return result as { model: VideoModelId; reasoning: string };
  } catch (e) {
    console.error('Failed to parse model recommendation JSON:', e);
    return { model: 'seedance', reasoning: 'Default recommendation due to an error.' };
  }
};

export const generateStoryboardFromPages = async (
  pageImages: { data: string; mimeType: string }[],
  characters: Pick<Character, 'name' | 'description'>[],
): Promise<InitialSceneData[]> => {
  const characterList = characters.map((c) => `- ${c.name}: ${c.description || 'No description'}`).join('\n');

  const systemInstruction = `You are a storyboard artist and animation director. Analyze the provided manga/webtoon page(s). Your task is to break down the pages into individual panels and create a plan to animate them. For each panel, you must:
1.  **sceneDescription**: Write a detailed prompt for an AI image generator to create the first frame of the animation for that panel. Describe it like a frame from a high-quality, modern anime series. This prompt should capture the characters, their expressions, the background, and the overall mood of the panel in a **vibrant, modern webtoon/anime style**. Include details about cinematic lighting, camera angle (e.g., low angle, over-the-shoulder), and depth of field if appropriate. If the panel background is minimal, abstract, or missing, you must invent and describe a plausible and detailed background that fits the scene's context and mood. **Crucially, you must ignore any speech bubbles, dialogue text, or sound effects; describe only the visual scene and action.** The resulting image must NOT be a real-life photo and should feel dynamic and emotional, not like a static comic panel.
2.  **narrative**: Describe the key action that should happen *during* the scene in a single sentence. This will be used to generate the end frame.
3.  **duration**: Estimate an appropriate duration for the animated scene in seconds (between 3 to 10 seconds). The duration must NOT exceed 10 seconds.
4.  **charactersInScene**: Based on the provided character list, identify which characters appear in this panel. List their names exactly as provided.
5.  **sourcePageIndex**: Provide the 0-based index of the page image this panel came from.

Your response must be a valid JSON array following the provided schema.

**Available Characters:**
${characterList}
`;

  const response = await generateText(
    {
      prompt: systemInstruction,
      referenceImages: normalizeReferenceImages(pageImages),
      jsonMode: true,
      jsonSchema: webtoonStoryboardSchema,
    },
    120000,
  );

  try {
    const panels = JSON.parse(response.text.trim()) as Omit<InitialSceneData, 'recommendedModel' | 'reasoning'>[];

    const enrichedPanels = await Promise.all(
      panels.map(async (panel) => {
        const { model, reasoning } = await recommendVideoModel(panel.sceneDescription, panel.narrative);
        return {
          ...panel,
          duration: Math.min(Math.round(panel.duration), 10),
          recommendedModel: model,
          reasoning: reasoning,
        };
      }),
    );

    return enrichedPanels;
  } catch (e) {
    console.error('Failed to parse webtoon storyboard or get recommendations:', e);
    throw new Error('Failed to get a valid storyboard from AI.');
  }
};

export const generateVideoFrame = async (
  prompt: string,
  referenceImage: { data: string; mimeType: string },
): Promise<string> => {
  const response = await generateImage(
    {
      prompt: `Using the provided blank 16:9 canvas as your drawing surface, create a new, single, full-screen animation frame based on the provided manga panel and the following description: "${prompt}".
                If the original panel has a simple, white, or abstract background, you MUST generate a complete, detailed, and fitting background that matches the scene's mood and context.
                IMPORTANT: The output MUST be a single, undivided 16:9 scene suitable for animation, NOT a comic panel layout.
                Strictly adhere to the art style, character designs, and color palette of the original webtoon page. The result must not be a real photo.`,
      referenceImages: normalizeReferenceImages([
        { data: blank16x9Canvas, mimeType: 'image/png' },
        referenceImage,
      ]),
      size: { width: 1280, height: 720 },
    },
    120000,
  );

  return response.image;
};

export const generateWebtoonEndFrame = async (
  startFrameBase64: string,
  narrative: string,
  duration: number,
): Promise<string> => {
  const prompt = `You are an expert animator. Use the provided blank 16:9 canvas as your drawing surface. Your task is to create a dynamic end frame for a short scene based on a start frame. The goal is to show clear and significant change over the scene's duration of ${duration} seconds.
    
    **Instructions:**
    1.  **Analyze the provided start frame** to understand the character's pose, expression, and the setting.
    2.  The key action that occurs during the scene is: "${narrative}".
    3.  **Generate an end frame** that depicts the clear *result* of this action.
    
    **Key Requirements:**
    - The end frame MUST be visually distinct from the start frame, showing a noticeable change in the character's pose, expression, or position.
    - The camera angle can shift slightly to add dynamism.
    - Maintain perfect consistency for the character's design, clothing, and the background.
    - The style MUST remain a vibrant, modern webtoon/anime style, matching the start frame.
    - The final output must be ONLY the edited 16:9 image.`;

  const response = await generateImage(
    {
      prompt,
      referenceImages: normalizeReferenceImages([
        { data: blank16x9Canvas, mimeType: 'image/png' },
        { data: startFrameBase64, mimeType: 'image/png' },
      ]),
      size: { width: 1280, height: 720 },
    },
    120000,
  );

  return response.image;
};

export const regenerateVideoFrame = async (
  originalFrameBase64: string,
  editPrompt: string,
  originalSceneDescription: string,
): Promise<string> => {
  const prompt = editPrompt
    ? `You are an expert animator revising a single frame of an animation.
        **Base Image:** The provided image is the original frame.
        **Instruction:** Modify the image based on this specific request: "${editPrompt}".
        **Context:** The original scene description was: "${originalSceneDescription}".
        **Task:** Re-render the image, applying the user's modification while maintaining the original art style, character designs, and overall composition. The output must be ONLY the edited 16:9 image.`
    : `You are an expert animator creating an alternative version of an animation frame.
        **Base Image:** The provided image is one version of the frame.
        **Context:** The original scene description was: "${originalSceneDescription}".
        **Task:** Generate a new, different version of this frame based on the original context. Offer a creative reinterpretation while strictly maintaining the art style, character designs, and cinematic 16:9 aspect ratio. The output must be ONLY the new 16:9 image.`;

  const response = await generateImage(
    {
      prompt,
      referenceImages: normalizeReferenceImages([{ data: originalFrameBase64, mimeType: 'image/png' }]),
      size: { width: 1280, height: 720 },
    },
    120000,
  );

  return response.image;
};

export const generateSuggestionsForScene = async (
  sceneDescription: string,
  duration: number,
): Promise<AISuggestions> => {
  const promptContent = `Based on the video scene idea "${sceneDescription}", generate creative suggestions for a ${duration}-second anime-style clip. The narrative must describe a clear, dynamic action with a visible outcome or change.`;

  const response = await generateText(
    {
      prompt: promptContent,
      jsonMode: true,
      jsonSchema: suggestionsSchema,
    },
    60000,
  );

  try {
    return JSON.parse(response.text.trim()) as AISuggestions;
  } catch (e) {
    console.error('Failed to parse suggestions JSON:', e);
    throw new Error('Failed to get valid suggestions from AI.');
  }
};

export const generateFinalVideoPrompt = async (
  sceneDescription: string,
  suggestions: AISuggestions,
  duration: number,
): Promise<string> => {
  const systemInstruction = `You are an expert prompt engineer for an AI video generator. Your task is to combine a scene idea and creative suggestions into a single, cohesive, and detailed video prompt. The final prompt should be a clear instruction for the AI, describing the ${duration}-second anime style scene in a single paragraph.`;

  const userPrompt = `
      Scene Idea: "${sceneDescription}" for a ${duration} second shot.
      Transition into scene with: "${suggestions.transition}"
      Visual Effect: "${suggestions.vfx}"
      Camera Work: "${suggestions.camera}"
      Narrative Action: "${suggestions.narrative}"

      Combine these into one detailed video prompt.
    `;

  const response = await generateText(
    {
      prompt: userPrompt,
      systemInstruction,
    },
    60000,
  );

  return response.text.trim();
};

const getCharacterAnchors = (
  scene: InitialSceneData,
  allCharacters: Pick<Character, 'name' | 'description'>[],
): string => {
  return scene.charactersInScene
    .map((charName) => {
      const charData = allCharacters.find((c) => c.name === charName);
      return `- character: ${charName}, ${charData?.description || 'No description'}`;
    })
    .join('\n');
};

export const generateSeedancePrompt = (
  scene: InitialSceneData,
  allCharacters: Pick<Character, 'name' | 'description'>[],
): string => {
  const charAnchors = getCharacterAnchors(scene, allCharacters);
  return `Title: Scene ${scene.sourcePageIndex + 1}
Duration: ${scene.duration}s  Aspect: 16:9  Style: cinematic, modern webtoon/anime style
Consistency anchors:
${charAnchors}
- mood: [auto-detect from scene]

Shot 1 (0-${scene.duration}s):
- action: ${scene.sceneDescription}. ${scene.narrative}.
- camera: [auto-detect from scene, cinematic]
- include anchors: all characters in scene

Negative:
- avoid: text artifacts, logos, watermarks, bad anatomy
`;
};

export const generateHailuoPrompt = (scene: InitialSceneData): string => {
  return `Task: Animate a short clip from a webtoon panel: ${scene.sceneDescription}
Length: ${scene.duration}s  Aspect: 16:9
Action physics:
- body mechanics: ${scene.narrative}, with realistic weight and momentum.
- speed profile: natural acceleration and deceleration.
- environment forces: subtle ambient motion.

Camera:
- rig: cinematic, dynamic camera that enhances the action.
- lens: 35mm
- move: subtle dolly or pan to follow action.

Look:
- style: vibrant, modern webtoon/anime, high contrast.
- lighting: cinematic lighting, rim lights, detailed shadows.

Negative:
- avoid: limb bending artifacts, background wobble, static comic look
`;
};

export const generateVeoPrompt = (scene: InitialSceneData): string => {
  return `Title: Webtoon Scene ${scene.sourcePageIndex + 1}
Duration: ${scene.duration}s  Aspect: 16:9  Style: High-quality anime scene, cinematic, detailed background.
Visual:
- Shot 1 (0-${scene.duration}s): ${scene.sceneDescription}. Action to perform: ${scene.narrative}.

Audio:
- sfx: [appropriate ambient sounds for the scene]
- music: [instrumental music matching the mood]

Negative:
- avoid: text, speech bubbles, panel borders, photorealism.
`;
};

export const generateKlingPrompt = (
  scene: InitialSceneData,
  allCharacters: Pick<Character, 'name' | 'description'>[],
): string => {
  const charLocks = scene.charactersInScene.join(', ');
  return `Mode: High  Length: ${scene.duration}s  Aspect: 16:9  Style: anime, cinematic
Reference images:
- subject: [The provided webtoon panel is the primary style and character reference]
Lock:
- keep: [${charLocks} hairstyle, color, outfit, face]
- do not change: character designs from reference.

Shot plan:
- Shot 1 (0-${scene.duration}s): ${scene.sceneDescription}. During the shot, ${scene.narrative}.

Camera & Look:
- lens [35mm], movement [subtle, cinematic], lighting [dramatic, source-aware]

Negative:
- avoid: ref drift, extra accessories, background text
`;
};

export const generateAllModelPrompts = async (
  scene: InitialSceneData,
  characters: Pick<Character, 'name' | 'description'>[],
): Promise<Record<string, string>> => {
  return {
    seedance: generateSeedancePrompt(scene, characters),
    hailuo: generateHailuoPrompt(scene),
    veo: generateVeoPrompt(scene),
    kling: generateKlingPrompt(scene, characters),
    agnes: generateVeoPrompt(scene), // Agnes uses the same structured prompt as Veo.
  };
};

export const generateVeoVideo = async (
  prompt: string,
  onProgressUpdate: (progress: string) => void,
  startFrame?: { data: string; mimeType: string },
): Promise<string> => {
  // Veo video generation still requires direct Gemini access.
  const apiKey = getApiKey();
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  onProgressUpdate('Starting video generation...');

  type VeoRequestPayload = {
    model: string;
    prompt: string;
    image?: { imageBytes: string; mimeType: string };
    config: { numberOfVideos: number };
  };

  const requestPayload: VeoRequestPayload = {
    model: 'veo-2.0-generate-001',
    prompt: prompt,
    config: {
      numberOfVideos: 1,
    },
  };

  if (startFrame?.data) {
    requestPayload.image = {
      imageBytes: startFrame.data.split(',')[1],
      mimeType: startFrame.mimeType,
    };
  }

  let operation = await ai.models.generateVideos(requestPayload);

  let pollCount = 0;
  const progressMessages = [
    'Casting characters...',
    'Setting up the scene...',
    "Director is shouting 'Action!'...",
    'Rendering photons...',
    'Compositing layers...',
    'Adding final touches...',
  ];

  while (!operation.done) {
    onProgressUpdate(progressMessages[pollCount % progressMessages.length]);
    await new Promise((resolve) => setTimeout(resolve, 10000)); // Poll every 10 seconds
    operation = await ai.operations.getVideosOperation({ operation: operation });
    pollCount++;
  }

  if (operation.error) {
    throw new Error(`Video generation failed: ${operation.error.message}`);
  }

  onProgressUpdate('Fetching video...');
  const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!downloadLink) {
    throw new Error('Video generation completed, but no download link was provided.');
  }

  const response = await fetch(`${downloadLink}&key=${apiKey}`);
  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.statusText}`);
  }
  const videoBlob = await response.blob();
  return URL.createObjectURL(videoBlob);
};

/**
 * Generate a video using the Agnes async task API via the project's server
 * (`POST /api/video`). Streams progress over SSE and returns a blob URL on
 * success. This is the free-tier alternative to Veo — works as a drop-in
 * replacement.
 */
export const generateAgnesVideo = async (
  prompt: string,
  onProgressUpdate: (progress: string) => void,
  startFrame?: { data: string; mimeType: string },
): Promise<string> => {
  onProgressUpdate('Starting video generation...');

  const baseUrl = getServerUrl();
  const res = await fetch(`${baseUrl}/api/video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      referenceImage: startFrame,
    }),
  });

  if (!res.ok || !res.body) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 500);
    } catch {
      /* ignore */
    }
    throw new Error(
      `Agnes video request failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`,
    );
  }

  // Parse SSE stream.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE events are separated by blank lines.
    let sepIdx;
    while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let evt: { type?: string; status?: string; video?: string; contentType?: string; error?: string };
      try {
        evt = JSON.parse(payload);
      } catch {
        continue;
      }
      if (evt.type === 'progress' && evt.status) {
        onProgressUpdate(evt.status);
      } else if (evt.type === 'done' && evt.video) {
        onProgressUpdate('Fetching video...');
        // Server returns a data URL (base64). Convert to a blob URL so the
        // existing <video src=...> consumers keep working unchanged.
        const dataUrl = evt.video;
        const r = await fetch(dataUrl);
        const blob = await r.blob();
        return URL.createObjectURL(blob);
      } else if (evt.type === 'error') {
        throw new Error(evt.error || 'Agnes video generation failed');
      }
    }
  }

  throw new Error('Agnes video stream ended without a result event.');
};

function getApiKey(): string {
  if (typeof process !== 'undefined' && process.env) {
    const envKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (envKey && envKey !== '""' && envKey !== 'undefined') return envKey as string;
  }
  throw new Error('GEMINI_API_KEY environment variable is required for Veo video generation.');
}
