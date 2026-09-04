-- V3.7 retire the directly callable unpinned v35 structure repair endpoint.
--
-- apply_rulebook_structure_repair_v36 is the public boundary. It asserts the
-- exact reviewed Rulebook content and then delegates internally to v35. Because
-- v36 is SECURITY DEFINER and owned by postgres, v35 can be removed from client
-- roles without duplicating the tested atomic implementation.

revoke execute on function public.apply_rulebook_structure_repair_v35(text,text,integer) from authenticated,service_role;
revoke all on function public.apply_rulebook_structure_repair_v35(text,text,integer) from public,anon;
