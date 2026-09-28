-- 006 · The welcome content
--
-- Kept apart from 005 because it is content, not behaviour: two large blocks of
-- JSONB with no logic in them. Separating them means a change to the wording is
-- a change to one obvious file, and a reader looking for how import works does
-- not have to wade through a worked example of a political theory map.

-- ----------------------------------------------------------------
-- Page 1 · Start here
-- ----------------------------------------------------------------
-- Between the two pages this exercises: groups, a card inside a group, links
-- between cards, links between a card and a group, every relationship that
-- appears in RELATIONSHIP_PRESETS, all three line styles, all three routings,
-- several arrowheads, and checklists. scripts/test-tutorial-content.cjs asserts
-- that, so the tutorial cannot quietly lose its point by being edited.
create or replace function public.tutorial_page_one()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'cards', jsonb_build_array(
      jsonb_build_object(
        'id', 'tut_welcome',
        'title', 'Welcome to Map204',
        'content',
          'This workspace is yours to change. Rename it, delete it, or add pages beside it.'
          || chr(10) || chr(10)
          || 'Everything you do is saved to your account and shared with whoever you invite.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 0, 'y', 0, 'width', 320, 'height', 250, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#EEF2FF', 'accentColor', '#6366F1', 'textColor', '#111827',
          'borderColor', '#C7D2FE', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('start-here'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut_basics',
        'title', 'The basics',
        'content',
          '**C** drops a card where you are looking.'
          || chr(10) || chr(10)
          || '- **G** adds a group, a box you can gather cards into'
          || chr(10)
          || '- **F** fits everything in view'
          || chr(10)
          || '- **Delete** removes whatever you have selected'
          || chr(10) || chr(10)
          || 'Drag a card by its header to move it, and drag the corner to resize.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 0, 'y', 320, 'width', 320, 'height', 320, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#FFFFFF', 'accentColor', '#0EA5E9', 'textColor', '#111827',
          'borderColor', '#E5E7EB', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('start-here'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(
          jsonb_build_object('id', 'tut_task_1', 'text', 'Press C to add a card', 'done', false),
          jsonb_build_object('id', 'tut_task_2', 'text', 'Press G to add a group', 'done', false),
          jsonb_build_object('id', 'tut_task_3', 'text', 'Connect two things with a drag', 'done', false)
        ),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut_groups',
        'title', 'Groups collect related cards',
        'content',
          'A group is a labelled box. Drop cards inside it and they belong to it'
          || chr(10)
          || 'together — useful for a section of an argument, or one week of notes.'
          || chr(10) || chr(10)
          || 'Groups can be linked to each other and to cards, so a box can be an'
          || chr(10)
          || 'argument in its own right.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 0, 'y', 720, 'width', 320, 'height', 300, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#ECFDF5', 'accentColor', '#16A34A', 'textColor', '#111827',
          'borderColor', '#BBF7D0', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('start-here', 'groups'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut_links',
        'title', 'Links carry meaning',
        'content',
          'Drag from one of the small dots on a card edge onto another card.'
          || chr(10) || chr(10)
          || 'The arrow picks the best side by itself. Click it to give the link a'
          || chr(10)
          || 'relationship, a colour, and a stroke.'
          || chr(10) || chr(10)
          || 'The three cards below are linked three different ways — a solid'
          || chr(10)
          || '**supports**, a dashed **part of**, and a dotted **contradicts**.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 440, 'y', 0, 'width', 340, 'height', 340, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#FFF7ED', 'accentColor', '#D97706', 'textColor', '#111827',
          'borderColor', '#FED7AA', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('start-here', 'links'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut_example_support',
        'title', 'Evidence',
        'content', 'The 1848 report gave the data.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 460, 'y', 420, 'width', 260, 'height', 170, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#FEF9C3', 'accentColor', '#CA8A04', 'textColor', '#111827',
          'borderColor', '#FDE68A', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('example'),
        'collapsed', false,
        'parentId', 'tut_group_evidence',
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut_example_claim',
        'title', 'Conclusion',
        'content', 'So the reform was caused by the harvest failure.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 460, 'y', 650, 'width', 260, 'height', 180, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#E0F2FE', 'accentColor', '#0284C7', 'textColor', '#111827',
          'borderColor', '#BAE6FD', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('example'),
        'collapsed', false,
        'parentId', 'tut_group_evidence',
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut_example_caveat',
        'title', 'A caveat',
        'content', 'But the tax records tell a different story.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 460, 'y', 890, 'width', 260, 'height', 180, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#FFF1F2', 'accentColor', '#E11D48', 'textColor', '#111827',
          'borderColor', '#FECDD3', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('example'),
        'collapsed', false,
        'parentId', 'tut_group_evidence',
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut_share',
        'title', 'Work on it together',
        'content',
          '**Share** in the top bar invites someone by email.'
          || chr(10) || chr(10)
          || '- **Can edit** — they can change anything'
          || chr(10)
          || '- **Can view** — they can look but not change'
          || chr(10) || chr(10)
          || 'You will see their cursor move, and you can click their avatar to'
          || chr(10)
          || 'follow along. Every workspace also has a colour and an icon, so you'
          || chr(10)
          || 'can tell your subjects apart at a glance.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 880, 'y', 0, 'width', 340, 'height', 400, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#FDF2F8', 'accentColor', '#DB2777', 'textColor', '#111827',
          'borderColor', '#FBCFE8', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('start-here', 'sharing'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut_pages',
        'title', 'Pages split a big subject',
        'content',
          'A workspace holds as many pages as you need. Use the panel on the left'
          || chr(10)
          || 'to add, rename, reorder and delete them.'
          || chr(10) || chr(10)
          || 'There is a second page here — **Making maps** — with a worked example'
          || chr(10)
          || 'of the whole thing put together.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 880, 'y', 470, 'width', 340, 'height', 320, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#F5F3FF', 'accentColor', '#7C3AED', 'textColor', '#111827',
          'borderColor', '#DDD6FE', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('start-here', 'pages'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      )
    ),
    'groups', jsonb_build_array(
      jsonb_build_object(
        'id', 'tut_group_evidence',
        'title', 'One argument, three cards',
        'position', jsonb_build_object('x', 430, 'y', 390, 'width', 320, 'height', 710, 'zIndex', 1),
        'color', '#0EA5E9',
        'memberCardIds', jsonb_build_array('tut_example_support', 'tut_example_claim', 'tut_example_caveat'),
        'memberGroupIds', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      )
    ),
    'connections', jsonb_build_array(
      -- Card to card, inside the group: the two links a reader will follow.
      jsonb_build_object(
        'id', 'tut_link_support',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut_example_support'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut_example_claim'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'supports',
        'relationshipType', 'supports',
        'style', jsonb_build_object(
          'color', '#16A34A', 'width', 2, 'lineStyle', 'solid', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'arrow', 'animated', false
        )
      ),
      jsonb_build_object(
        'id', 'tut_link_contradicts',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut_example_caveat'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut_example_claim'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'contradicts',
        'relationshipType', 'contradicts',
        'style', jsonb_build_object(
          'color', '#E11D48', 'width', 2, 'lineStyle', 'dotted', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'triangle', 'animated', false
        )
      ),
      -- Card to group: proves a group can take part in the link graph.
      jsonb_build_object(
        'id', 'tut_link_to_group',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut_links'),
        'target', jsonb_build_object('kind', 'group', 'id', 'tut_group_evidence'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'see it here',
        'relationshipType', 'example of',
        'style', jsonb_build_object(
          'color', '#6366F1', 'width', 2, 'lineStyle', 'dashed', 'routing', 'stepped',
          'arrowStart', 'none', 'arrowEnd', 'circle', 'animated', false
        )
      ),
      -- The reading order of the tutorial itself, so a new account can see the
      -- shape of a finished map before making one.
      jsonb_build_object(
        'id', 'tut_link_welcome_basics',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut_welcome'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut_basics'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'start with',
        'relationshipType', 'leads to',
        'style', jsonb_build_object(
          'color', '#6366F1', 'width', 2, 'lineStyle', 'solid', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'arrow', 'animated', false
        )
      ),
      jsonb_build_object(
        'id', 'tut_link_basics_groups',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut_basics'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut_groups'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'next',
        'relationshipType', 'leads to',
        'style', jsonb_build_object(
          'color', '#6366F1', 'width', 2, 'lineStyle', 'solid', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'arrow', 'animated', false
        )
      ),
      jsonb_build_object(
        'id', 'tut_link_groups_links',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut_groups'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut_links'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'then',
        'relationshipType', 'leads to',
        'style', jsonb_build_object(
          'color', '#6366F1', 'width', 2, 'lineStyle', 'solid', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'arrow', 'animated', false
        )
      ),
      jsonb_build_object(
        'id', 'tut_link_links_pages',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut_links'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut_pages'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'then',
        'relationshipType', 'leads to',
        'style', jsonb_build_object(
          'color', '#6366F1', 'width', 2, 'lineStyle', 'solid', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'arrow', 'animated', false
        )
      ),
      jsonb_build_object(
        'id', 'tut_link_pages_share',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut_pages'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut_share'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'and',
        'relationshipType', 'leads to',
        'style', jsonb_build_object(
          'color', '#6366F1', 'width', 2, 'lineStyle', 'solid', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'arrow', 'animated', false
        )
      )
    )
  );
$$;

-- ----------------------------------------------------------------
-- Page 2 · Making maps
-- ----------------------------------------------------------------
-- A worked example rather than a feature list: a claim, the evidence for it, the
-- strongest objection, the reply, and what is still missing. It is the shape an
-- essay actually takes, which is the point.
create or replace function public.tutorial_page_two()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'cards', jsonb_build_array(
      jsonb_build_object(
        'id', 'tut2_thesis',
        'title', 'The thesis',
        'content',
          'Start from the one sentence you are trying to defend. Everything else'
          || chr(10)
          || 'on this page hangs off it.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 0, 'y', 260, 'width', 300, 'height', 200, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#EEF2FF', 'accentColor', '#6366F1', 'textColor', '#111827',
          'borderColor', '#C7D2FE', 'borderWidth', 2, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('method'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut2_evidence_one',
        'title', 'Evidence A',
        'content', 'A primary source that backs the thesis.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 0, 'y', 0, 'width', 280, 'height', 180, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#FEF9C3', 'accentColor', '#CA8A04', 'textColor', '#111827',
          'borderColor', '#FDE68A', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('method'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(
          jsonb_build_object('id', 'tut2_task_a', 'text', 'Quote it', 'done', false)
        ),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut2_evidence_two',
        'title', 'Evidence B',
        'content', 'A second, independent source.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 0, 'y', 540, 'width', 280, 'height', 180, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#FEF9C3', 'accentColor', '#CA8A04', 'textColor', '#111827',
          'borderColor', '#FDE68A', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('method'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(
          jsonb_build_object('id', 'tut2_task_b', 'text', 'Check it is independent', 'done', false)
        ),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut2_objection',
        'title', 'The strongest objection',
        'content',
          'Write down the best argument against you. If you cannot, you have not'
          || chr(10)
          || 'understood the topic yet — and neither has your reader.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 400, 'y', 0, 'width', 300, 'height', 220, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#FFF1F2', 'accentColor', '#E11D48', 'textColor', '#111827',
          'borderColor', '#FECDD3', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('method'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut2_rebuttal',
        'title', 'Your reply',
        'content', 'And then the card that answers it.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 800, 'y', 0, 'width', 300, 'height', 220, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#ECFDF5', 'accentColor', '#16A34A', 'textColor', '#111827',
          'borderColor', '#BBF7D0', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('method'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut2_gaps',
        'title', 'What is still missing',
        'content',
          'The gaps are the useful part. Anything you could not source goes here,'
          || chr(10)
          || 'and it is obvious what your next hour of reading should be for.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 400, 'y', 300, 'width', 300, 'height', 220, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#F5F3FF', 'accentColor', '#7C3AED', 'textColor', '#111827',
          'borderColor', '#DDD6FE', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('method'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(
          jsonb_build_object('id', 'tut2_task_g1', 'text', 'Find a source for the claim', 'done', false),
          jsonb_build_object('id', 'tut2_task_g2', 'text', 'Ask about it in the seminar', 'done', false),
          jsonb_build_object('id', 'tut2_task_g3', 'text', 'Rewrite the conclusion', 'done', false)
        ),
        'createdAt', now()::text,
        'updatedAt', now()::text
      )
    ),
    'groups', jsonb_build_array(
      jsonb_build_object(
        'id', 'tut2_group_evidence',
        'title', 'Your evidence',
        'position', jsonb_build_object('x', -30, 'y', -30, 'width', 340, 'height', 790, 'zIndex', 1),
        'color', '#CA8A04',
        'memberCardIds', jsonb_build_array('tut2_evidence_one', 'tut2_thesis', 'tut2_evidence_two'),
        'memberGroupIds', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut2_group_reply',
        'title', 'The objection and the reply',
        'position', jsonb_build_object('x', 370, 'y', -30, 'width', 760, 'height', 290, 'zIndex', 1),
        'color', '#E11D48',
        'memberCardIds', jsonb_build_array('tut2_objection', 'tut2_rebuttal'),
        'memberGroupIds', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      )
    ),
    'connections', jsonb_build_array(
      -- Group to card: the evidence box itself points at what it proves.
      jsonb_build_object(
        'id', 'tut2_link_evidence_group',
        'source', jsonb_build_object('kind', 'group', 'id', 'tut2_group_evidence'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut2_thesis'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'proves',
        'relationshipType', 'supports',
        'style', jsonb_build_object(
          'color', '#CA8A04', 'width', 2, 'lineStyle', 'solid', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'arrow', 'animated', false
        )
      ),
      jsonb_build_object(
        'id', 'tut2_link_a',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut2_evidence_one'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut2_thesis'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'supports',
        'relationshipType', 'supports',
        'style', jsonb_build_object(
          'color', '#CA8A04', 'width', 2, 'lineStyle', 'solid', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'arrow', 'animated', false
        )
      ),
      jsonb_build_object(
        'id', 'tut2_link_b',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut2_evidence_two'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut2_thesis'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'supports',
        'relationshipType', 'supports',
        'style', jsonb_build_object(
          'color', '#CA8A04', 'width', 2, 'lineStyle', 'solid', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'arrow', 'animated', false
        )
      ),
      jsonb_build_object(
        'id', 'tut2_link_objection',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut2_objection'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut2_thesis'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'challenges',
        'relationshipType', 'contradicts',
        'style', jsonb_build_object(
          'color', '#E11D48', 'width', 2, 'lineStyle', 'dotted', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'triangle', 'animated', false
        )
      ),
      -- Card into a group, the other way round: a card that is a *part of* the
      -- section it sits in.
      jsonb_build_object(
        'id', 'tut2_link_objection_part',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut2_objection'),
        'target', jsonb_build_object('kind', 'group', 'id', 'tut2_group_reply'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'belongs to',
        'relationshipType', 'part of',
        'style', jsonb_build_object(
          'color', '#E11D48', 'width', 1, 'lineStyle', 'dotted', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'none', 'animated', false
        )
      ),
      jsonb_build_object(
        'id', 'tut2_link_rebuttal',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut2_rebuttal'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut2_objection'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'answers',
        'relationshipType', 'related to',
        'style', jsonb_build_object(
          'color', '#16A34A', 'width', 2, 'lineStyle', 'dashed', 'routing', 'stepped',
          'arrowStart', 'none', 'arrowEnd', 'arrow', 'animated', false
        )
      ),
      jsonb_build_object(
        'id', 'tut2_link_gaps',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut2_gaps'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut2_thesis'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'undermines',
        'relationshipType', 'depends on',
        'style', jsonb_build_object(
          'color', '#7C3AED', 'width', 2, 'lineStyle', 'dashed', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'circle', 'animated', false
        )
      )
    )
  );
$$;
