/**
 * Generate a random image generation prompt for testing.
 */
export function promptGenerator(): string {

  const subjects = ["a cat", "a dog", "a futuristic city", "a beautiful landscape", "an astronaut", "a dragon", "a robot", "a magical forest"];
  const styles = ["in the style of Van Gogh", "as a Pixar movie", "like a watercolor painting", "as a cyberpunk scene", "in a surrealist style", "like a comic book illustration"];
  const actions = ["flying through the sky", "exploring a new world", "sitting on a throne", "dancing in the rain", "holding a glowing orb", "standing on a mountain peak"];

  const subject = subjects[Math.floor(Math.random() * subjects.length)];
  const style = styles[Math.floor(Math.random() * styles.length)];
  const action = actions[Math.floor(Math.random() * actions.length)];

  return `A high-resolution image of ${subject} ${action}, ${style}, vibrant colors, detailed, 4k resolution`;

}

/**
 * Generate a random prompt specifically for the Anime XL model. Using more anime-focused elements and danbooru-style tags.
 */
export function animeXLPromptGenerator(): string {
  const subjects = ["1girl", "2boys", "catgirl", "mecha", "futuristic city", "magical girl", "samurai", "ninja"];
  const styles = ["anime style", "manga style", "chibi style", "cyberpunk anime", "fantasy anime", "mecha anime"];
  const actions = ["holding a katana", "sitting under cherry blossoms", "flying through the sky", "exploring a futuristic city", "casting a spell", "standing on a rooftop"];

  const subject = subjects[Math.floor(Math.random() * subjects.length)];
  const style = styles[Math.floor(Math.random() * styles.length)];
  const action = actions[Math.floor(Math.random() * actions.length)];

  return `${subject}, ${action}, ${style}, masterpiece, absurdres`;
}

export const NEGATIVE_PROMPT = `
lowres, bad anatomy, error body, error arm, error hand, error fingers,
error legs, error feet, missing fingers, extra digit, fewer digits, cropped,
worst quality, low quality, jpeg artifacts, ugly, duplicate, morbid, mutilated,
out of frame, worst quality, low quality, naked, watermark, text, error, nsfw, nude
`;