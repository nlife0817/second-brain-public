import { NextRequest, NextResponse } from "next/server";
import {
  getAllItemsFull,
  getAllTags,
  getAllCategories,
  getAllClientsFull,
  getAllClientStatuses,
  getAllCrmSystems,
  getAllDevelopmentStages,
  getAllDevelopmentParticipants,
  getAllRelationTypes,
  getAllStagingItems,
  getRelationCountsBatch,
  getCommentCountsBatch,
  getRelationTitlesBatch,
  getItemLinkedClientsBatch,
} from "@/lib/db";
import { ensureKaitenSyncScheduler } from "@/lib/kaiten/sync";

export async function GET(req: NextRequest) {
  ensureKaitenSyncScheduler();

  const showArchived = req.nextUrl.searchParams.get("archived") === "true";
  const includeChildren = req.nextUrl.searchParams.get("children") === "true";

  const items = getAllItemsFull(showArchived, includeChildren);
  const tags = getAllTags();
  const categories = getAllCategories();
  const clients = getAllClientsFull();
  const clientStatuses = getAllClientStatuses();
  const crmSystems = getAllCrmSystems();
  const developmentStages = getAllDevelopmentStages();
  const allParticipants = getAllDevelopmentParticipants();
  const relationTypes = getAllRelationTypes();
  const stagingItems = getAllStagingItems("pending");

  const itemRelationCounts = getRelationCountsBatch("item");
  const itemCommentCounts = getCommentCountsBatch("item");
  const clientRelationCounts = getRelationCountsBatch("client");
  const clientCommentCounts = getCommentCountsBatch("client");
  const itemRelationTitles = getRelationTitlesBatch("item");
  const itemLinkedClients = getItemLinkedClientsBatch();

  return NextResponse.json({
    items,
    tags,
    categories,
    clients,
    clientStatuses,
    crmSystems,
    developmentStages,
    allParticipants,
    relationTypes,
    stagingItems,
    itemRelationCounts,
    itemCommentCounts,
    clientRelationCounts,
    clientCommentCounts,
    itemRelationTitles,
    itemLinkedClients,
  });
}
