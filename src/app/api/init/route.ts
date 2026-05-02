import { NextRequest, NextResponse } from "next/server";
import {
  getAllItemsFull,
  getAllTags,
  getAllCategories,
  getAllClientsFull,
  getAllClientStatuses,
  getAllCrmSystems,
  getAllDevelopmentStages,
  getAllItemStatuses,
  getAllDevelopmentParticipants,
  getAllRelationTypes,
  getAllStagingItems,
  getRelationCountsBatch,
  getCommentCountsBatch,
  getRelationTitlesBatch,
  getItemLinkedClientsBatch,
} from "@/lib/db";

export async function GET(req: NextRequest) {
  const showArchived = req.nextUrl.searchParams.get("archived") === "true";
  const includeChildren = req.nextUrl.searchParams.get("children") === "true";

  const items = await getAllItemsFull(showArchived, includeChildren);
  const tags = await getAllTags();
  const categories = await getAllCategories();
  const clients = await getAllClientsFull();
  const clientStatuses = await getAllClientStatuses();
  const crmSystems = await getAllCrmSystems();
  const developmentStages = await getAllDevelopmentStages();
  const itemStatuses = await getAllItemStatuses();
  const allParticipants = await getAllDevelopmentParticipants();
  const relationTypes = await getAllRelationTypes();
  const stagingItems = await getAllStagingItems("pending");

  const itemRelationCounts = await getRelationCountsBatch("item");
  const itemCommentCounts = await getCommentCountsBatch("item");
  const clientRelationCounts = await getRelationCountsBatch("client");
  const clientCommentCounts = await getCommentCountsBatch("client");
  const itemRelationTitles = await getRelationTitlesBatch("item");
  const itemLinkedClients = await getItemLinkedClientsBatch();

  return NextResponse.json({
    items,
    tags,
    categories,
    clients,
    clientStatuses,
    crmSystems,
    developmentStages,
    itemStatuses,
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
