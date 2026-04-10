/**
 * Content Scheduler — schedules posts with auto-generation triggers.
 * 
 * Posts can be scheduled with a date/time. The scheduler checks every minute
 * for posts that are due, auto-generates content if needed, and marks them
 * as ready to publish.
 */
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../../utils/logger';

const log = createLogger('ContentScheduler');

export type PostStatus = 'draft' | 'scheduled' | 'generating' | 'ready' | 'published' | 'failed';
export type Platform = 'instagram' | 'facebook' | 'tiktok';

export interface ScheduledPost {
  id: string;
  city: string;
  platform: Platform;
  trend?: string;
  screen?: string;
  caption?: string;
  hashtags?: string;
  cta?: string;
  imageUrl?: string;
  scheduledAt: string; // ISO date
  status: PostStatus;
  createdAt: string;
  generatedAt?: string;
  publishedAt?: string;
  error?: string;
}

const STORE_PATH = path.join(process.cwd(), 'data', 'scheduled-posts.json');

export class ContentScheduler {
  private posts: ScheduledPost[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private onGenerate?: (post: ScheduledPost) => Promise<ScheduledPost>;

  constructor(onGenerate?: (post: ScheduledPost) => Promise<ScheduledPost>) {
    this.onGenerate = onGenerate;
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(STORE_PATH)) {
        this.posts = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
      }
    } catch { this.posts = []; }
  }

  private save() {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(this.posts, null, 2));
  }

  schedule(post: Omit<ScheduledPost, 'id' | 'status' | 'createdAt'>): ScheduledPost {
    const newPost: ScheduledPost = {
      ...post,
      id: uuidv4(),
      status: 'scheduled',
      createdAt: new Date().toISOString(),
    };
    this.posts.push(newPost);
    this.save();
    log.info({ id: newPost.id, scheduledAt: newPost.scheduledAt, city: newPost.city }, 'Post scheduled');
    return newPost;
  }

  getAll(): ScheduledPost[] {
    return [...this.posts].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  }

  getById(id: string): ScheduledPost | undefined {
    return this.posts.find(p => p.id === id);
  }

  update(id: string, updates: Partial<ScheduledPost>): ScheduledPost | undefined {
    const post = this.posts.find(p => p.id === id);
    if (!post) return undefined;
    Object.assign(post, updates);
    this.save();
    return post;
  }

  delete(id: string): boolean {
    const idx = this.posts.findIndex(p => p.id === id);
    if (idx === -1) return false;
    this.posts.splice(idx, 1);
    this.save();
    return true;
  }

  getByDate(date: string): ScheduledPost[] {
    return this.posts.filter(p => p.scheduledAt.startsWith(date));
  }

  getByMonth(year: number, month: number): ScheduledPost[] {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    return this.posts.filter(p => p.scheduledAt.startsWith(prefix));
  }

  /** Start the auto-trigger loop — checks every 30 seconds */
  startAutoTrigger() {
    if (this.timer) return;
    log.info('Auto-trigger started (30s interval)');
    this.timer = setInterval(() => this.checkDuePosts(), 30000);
    this.checkDuePosts(); // run immediately
  }

  stopAutoTrigger() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private async checkDuePosts() {
    const now = new Date();
    const duePosts = this.posts.filter(p =>
      p.status === 'scheduled' && new Date(p.scheduledAt) <= now
    );

    for (const post of duePosts) {
      if (!post.caption && this.onGenerate) {
        post.status = 'generating';
        this.save();
        log.info({ id: post.id, city: post.city }, 'Auto-generating content for scheduled post');

        try {
          const generated = await this.onGenerate(post);
          Object.assign(post, generated, { status: 'ready', generatedAt: new Date().toISOString() });
          this.save();
          log.info({ id: post.id }, 'Content generated, ready to publish');
        } catch (err: any) {
          post.status = 'failed';
          post.error = err.message;
          this.save();
          log.error({ id: post.id, error: err.message }, 'Auto-generation failed');
        }
      } else {
        post.status = 'ready';
        this.save();
      }
    }
  }

  getStats() {
    const total = this.posts.length;
    const byStatus: Record<string, number> = {};
    for (const p of this.posts) byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    const upcoming = this.posts.filter(p => p.status === 'scheduled' && new Date(p.scheduledAt) > new Date()).length;
    return { total, byStatus, upcoming };
  }
}
