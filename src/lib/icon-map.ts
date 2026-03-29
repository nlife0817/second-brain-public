import {
  FolderKanban, Code2, Users, FlaskConical, MoreHorizontal,
  Target, Rocket, TrendingUp, Sparkles, BookOpen, Folder,
  Briefcase, Heart, Star, Zap, Globe, Package,
  Headphones, MessageSquare, Shield, PenTool, Layers,
  Settings, Cpu, Database, BarChart3, Lightbulb,
  Monitor, ExternalLink,
  type LucideIcon,
} from "lucide-react";

export const ICON_MAP: Record<string, LucideIcon> = {
  FolderKanban,
  Code2,
  Users,
  FlaskConical,
  MoreHorizontal,
  Target,
  Rocket,
  TrendingUp,
  Sparkles,
  BookOpen,
  Folder,
  Briefcase,
  Heart,
  Star,
  Zap,
  Globe,
  Package,
  Headphones,
  MessageSquare,
  Shield,
  PenTool,
  Layers,
  Settings,
  Cpu,
  Database,
  BarChart3,
  Lightbulb,
  Monitor,
  ExternalLink,
};

export const CATEGORY_ICON_OPTIONS = Object.keys(ICON_MAP);

export function getIcon(name: string): LucideIcon {
  return ICON_MAP[name] ?? Folder;
}

export const SOURCE_ICON_MAP: Record<string, LucideIcon> = {
  Monitor,
  ExternalLink,
  Sparkles,
};
