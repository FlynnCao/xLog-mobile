import { indexer } from "@crossbell/indexer";
import type { CharacterEntity, Contract, ListResponse, MintedNoteEntity, NoteEntity } from "crossbell";
import type { Address } from "viem";

import { PageVisibilityEnum } from "@/types";
import type { ExpandedNote } from "@/types/crossbell";
import { expandCrossbellNote } from "@/utils/expand-unit";
import { getKeys, getStorage } from "@/utils/storage";

const getLocalPages = async (input: {
  characterId: number
  isPost?: boolean
  handle?: string
}) => {
  const pages: ExpandedNote[] = [];
  const keys = getKeys([`draft-${input.characterId}-`, `draft-${input.handle}-`]);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    const page = await getStorage(key);
    if (input.isPost === undefined || page.isPost === input.isPost) {
      const note: ExpandedNote = {
        characterId: input.characterId,
        noteId: 0,
        draftKey: key
          .replace(`draft-${input.characterId}-`, "")
          .replace(`draft-${input.handle}-${input.characterId}-`, ""), // In order to be compatible with old drafts
        linkItemType: null,
        linkKey: "",
        toCharacterId: null,
        toAddress: null,
        toNoteId: null,
        toHeadCharacterId: null,
        toHeadNoteId: null,
        toContractAddress: null,
        toTokenId: null,
        toLinklistId: null,
        toUri: null,
        deleted: false,
        locked: false,
        contractAddress: null,
        uri: null,
        operator: "0x",
        owner: "0x",
        createdAt: new Date(page.date).toISOString(),
        updatedAt: new Date(page.date).toISOString(),
        deletedAt: null,
        transactionHash: "0x",
        blockNumber: 0,
        logIndex: 0,
        updatedTransactionHash: "0x",
        updatedBlockNumber: 0,
        updatedLogIndex: 0,
        metadata: {
          content: {
            title: page.values?.title,
            content: page.values?.content,
            date_published: page.values?.publishedAt,
            summary: page.values?.excerpt,
            tags: [
              page.isPost ? "post" : "page",
              ...(page.values?.tags
                ?.split(",")
                .map((tag: string) => tag.trim())
                .filter((tag: string) => tag) || []),
            ],
            slug: page.values?.slug,
            sources: ["xlog"],
          },
        },
        local: true,
      };
      pages.push(note);
    }
  }
  return pages;
};

export async function getMints({
  characterId,
  noteId,
  cursor,
  includeCharacter,
}: {
  characterId: number
  noteId: number
  cursor?: string
  includeCharacter?: boolean
}) {
  const data = await indexer.mintedNote.getManyOfNote(characterId, noteId, {
    cursor,
    limit: 5,
  });

  if (includeCharacter) {
    await Promise.all(
      data.list.map(async (item: any) => {
        if (!item.character) {
          item.character = await indexer.character.getPrimary(item.owner);
        }
      }),
    );
  }

  return data as ListResponse<
  MintedNoteEntity & {
    character: CharacterEntity
  }
  >;
}

export async function checkMint({
  address,
  noteCharacterId,
  noteId,
}: {
  address: string
  noteCharacterId: number
  noteId: number
}) {
  return indexer.mintedNote.getManyOfAddress(address as Address, {
    noteCharacterId,
    noteId,
  });
}

export async function getComment(...parmas: Parameters<typeof indexer.note.get>) {
  const res = (await indexer.note.get(...parmas)) || {
    count: 0,
    list: [],
  };

  return res as Awaited<ReturnType<typeof indexer.note.get>>;
}

export async function getComments({
  characterId,
  noteId,
  cursor,
  limit,
}: {
  characterId: number
  noteId: number
  cursor?: string
  limit?: number
}) {
  type Options = Parameters<typeof indexer.note.getMany>[0];
  const options: Options = {
    toCharacterId: characterId,
    toNoteId: noteId,
    cursor,
    includeCharacter: true,
    includeNestedNotes: true,
    nestedNotesDepth: 3 as const,
    nestedNotesLimit: 20,
    limit: limit ?? 5,
  };

  const res = (await indexer.note.getMany(options)) || {
    count: 0,
    list: [],
  };

  return res as Awaited<ReturnType<typeof indexer.note.getMany>>;
}

export async function updateComment(
  {
    content,
    externalUrl,
    characterId,
    noteId,
  }: {
    content: string
    externalUrl: string
    characterId: number
    noteId: number
  },
  contract: Contract,
) {
  return contract.note.setMetadata({
    characterId,
    noteId,
    metadata: {
      content,
      external_urls: [externalUrl],
      tags: ["comment"],
      sources: ["xlog"],
    },
  });
}

export async function checkMirror(characterId: number) {
  const notes = await indexer.note.getMany({
    characterId,
    sources: "xlog",
    tags: ["post", "Mirror.xyz"],
    limit: 0,
  });

  return notes.count === 0;
}

export async function getPage(input: {
  slug?: string
  characterId: number
  useStat?: boolean
  noteId?: number
  handle?: string // In order to be compatible with old drafts
}) {
  const mustLocal = input.slug?.startsWith("local-");

  let page: NoteEntity | null = null;

  if (!mustLocal) {
    if (!input.noteId) {
      const response = await fetch(
        `${indexer.endpoint}/api/slug2id?${new URLSearchParams({
          characterId: `${input.characterId}`,
          slug: input.slug!,
        }).toString()}`,
      );
      input.noteId = (await response.json())?.noteId;
    }
    if (input.noteId) {
      page = await indexer.note.get(input.characterId, input.noteId);
    }
  }

  // local page
  const local = await getLocalPages({
    characterId: input.characterId,
    handle: input.handle,
  });
  const localPages = local.filter(
    page =>
      page.draftKey === `${input.noteId}` || page.draftKey === input.slug,
  );
  const localPage
    = localPages.length
    && localPages.reduce((prev, current) => {
      return prev.updatedAt > current.updatedAt ? prev : current;
    });

  let expandedNote: ExpandedNote | undefined;

  if (page) {
    expandedNote = await expandCrossbellNote(page, input.useStat);
  }

  if (localPage) {
    if (expandedNote) {
      if (new Date(localPage.updatedAt) > new Date(expandedNote.updatedAt)) {
        expandedNote = {
          ...expandedNote,
          metadata: {
            content: localPage.metadata?.content,
          },
          local: true,
        };
      }
    }
    else {
      expandedNote = localPage;
    }
  }

  if (!expandedNote && !mustLocal) {
    throw new Error(`page ${input.slug} not found`);
  }

  return expandedNote;
}

export async function getPagesBySite(input: {
  characterId?: number
  type: "post" | "page"
  visibility?: PageVisibilityEnum
  limit?: number
  cursor?: string
  tags?: string[]
  useStat?: boolean
  keepBody?: boolean
  handle?: string // In order to be compatible with old drafts
}) {
  if (!input.characterId) {
    return {
      count: 0,
      list: [],
      cursor: null,
    };
  }

  const visibility = input.visibility || PageVisibilityEnum.All;

  const notes = await indexer.note.getMany({
    characterId: input.characterId,
    limit: input.limit || 10,
    cursor: input.cursor,
    orderBy: "publishedAt",
    tags: [...(input.tags || []), input.type],
    sources: "xlog",
  });

  const list = await Promise.all(
    notes?.list.map(async (note) => {
      const expanded = await expandCrossbellNote(note, input.useStat);
      if (!input.keepBody) {
        delete expanded.metadata?.content?.content;
      }
      return expanded;
    }),
  );

  const expandedNotes: {
    list: ExpandedNote[]
    count: number
    cursor: string | null
  } = Object.assign(notes, {
    list,
  });

  const local = await getLocalPages({
    characterId: input.characterId,
    isPost: input.type === "post",
    handle: input.handle,
  });

  local.forEach((localPage) => {
    const index = expandedNotes.list.findIndex(
      page => localPage.draftKey === `${page.noteId || page.draftKey}`,
    );
    if (index !== -1) {
      if (
        new Date(localPage.updatedAt)
        > new Date(expandedNotes.list[index].updatedAt)
      ) {
        expandedNotes.list[index] = {
          ...expandedNotes.list[index],
          metadata: {
            content: localPage.metadata?.content,
          },
          local: true,
          draftKey: localPage.draftKey,
        };
      }
    }
    else {
      expandedNotes.list.push(localPage);
      expandedNotes.count++;
    }
  });

  switch (visibility) {
    case PageVisibilityEnum.Published:
      expandedNotes.list = expandedNotes.list.filter(
        page =>
          (!page.metadata?.content?.date_published
            || +new Date(page.metadata?.content?.date_published) <= +new Date())
          && page.noteId,
      );
      break;
    case PageVisibilityEnum.Draft:
      expandedNotes.list = expandedNotes.list.filter(page => !page.noteId);
      break;
    case PageVisibilityEnum.Scheduled:
      expandedNotes.list = expandedNotes.list.filter(
        page =>
          page.metadata?.content?.date_published
          && +new Date(page.metadata?.content?.date_published) > +new Date(),
      );
      break;
  }

  expandedNotes.list = expandedNotes.list.sort((a, b) =>
    a.metadata?.content?.date_published && b.metadata?.content?.date_published
      ? +new Date(b.metadata?.content?.date_published)
      - +new Date(a.metadata?.content?.date_published)
      : 0,
  );

  return expandedNotes;
}
